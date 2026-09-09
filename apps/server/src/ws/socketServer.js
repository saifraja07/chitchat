import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { config } from '../config/env.js';
import { createConnectionValidation } from './middleware/connectionValidation.js';
import { withValidation } from './eventValidation.js';
import { heartbeatPayloadSchema } from './schemas.js';
import { createSocketRateLimiter } from './rateLimiter.js';
import { createIpConnectionLimiter } from './ipConnectionLimiter.js';
import { createSessionActionLock } from './sessionActionLock.js';
import { registerMatchmakingHandlers, cleanupMatchmakingOnDisconnect } from './matchmakingHandlers.js';
import { registerChatHandlers } from './chatHandlers.js';
import { registerWebrtcHandlers } from './webrtcHandlers.js';
import { createSession, refreshSession, destroySession } from '../domain/session/sessionService.js';
import { buildIceServers } from '../domain/webrtc/iceServers.js';
import { getRedisClient } from '../infra/redis/redisClient.js';

/**
 * Creates and attaches the Socket.IO server to an existing HTTP server.
 *
 * Architecture notes:
 * - Single default namespace, no custom namespaces/rooms of our own.
 *   Socket.IO's built-in per-socket-id room (every socket auto-joins a
 *   room named after its own id) is enough to target a specific peer
 *   for matchmaking notifications — no bespoke room management needed.
 * - The Redis adapter makes `io.to(socketId).emit(...)` work correctly
 *   even when the target socket is connected to a *different* backend
 *   instance, which is required once more than one instance is running
 *   behind a load balancer.
 * - The server is the only source of truth for session, queue, and room
 *   state. The client never supplies its own session/room/peer/mode
 *   state as fact — queue:join's `mode` is an intent, not a state claim,
 *   and match:next/match:leave carry no payload at all: the server
 *   derives what to do entirely from what it already knows about the
 *   session.
 * - Every client-supplied event payload is validated (see
 *   eventValidation.js) before it reaches any handler, and
 *   session-mutating events are serialized per-socket (see
 *   sessionActionLock.js) so rapid duplicate clicks can't race.
 * - Every mutating event type has its own rate limiter, and connections
 *   themselves are rate-limited per IP (see ipConnectionLimiter.js) —
 *   defense in depth against abuse at each layer, not just one gate.
 */

const HEARTBEAT_RATE_LIMIT = { windowMs: 30_000, max: 10 }; // generous: client sends ~1 every 20s
const ICE_CANDIDATE_RATE_LIMIT = { windowMs: 10_000, max: 100 }; // ICE gathering can produce many quickly

export async function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigins,
      credentials: false,
    },
    connectTimeout: 10_000,
    // Default is 1MB — our largest legitimate payload (an SDP blob) is
    // capped at 20KB by its own schema, and everything else is smaller
    // still. Capping the transport layer itself rejects grossly
    // oversized payloads before they even reach parsing/validation.
    maxHttpBufferSize: 64 * 1024,
  });

  // Dedicated pub/sub connections for the adapter, per @socket.io/redis-adapter's
  // requirements — a subscriber connection can't also run normal commands.
  // Both the shared pubClient and this new subClient use lazyConnect, so the
  // subscriber needs an explicit connect() before the adapter can subscribe.
  const pubClient = getRedisClient();
  const subClient = pubClient.duplicate();
  // duplicate() creates a fresh client with its own EventEmitter — it does
  // NOT inherit pubClient's error handlers. An 'error' event with zero
  // listeners crashes the process (standard Node EventEmitter behavior),
  // so this needs its own handler, even though all it does is keep the
  // process alive by acknowledging the error.
  subClient.on('error', (err) => console.error('Redis subscriber connection error:', err));
  await subClient.connect();
  io.adapter(createAdapter(pubClient, subClient));

  const ipLimiter = createIpConnectionLimiter(config.connectionLimit);
  io.use(createConnectionValidation(ipLimiter));

  const heartbeatLimiter = createSocketRateLimiter(HEARTBEAT_RATE_LIMIT);
  const chatRateLimiter = createSocketRateLimiter({
    windowMs: config.chat.rateLimitWindowMs,
    max: config.chat.rateLimitMax,
  });
  const iceRateLimiter = createSocketRateLimiter(ICE_CANDIDATE_RATE_LIMIT);
  const matchActionLimiter = createSocketRateLimiter({
    windowMs: config.matchAction.rateLimitWindowMs,
    max: config.matchAction.rateLimitMax,
  });
  const signalRateLimiter = createSocketRateLimiter({
    windowMs: config.webrtcSignal.rateLimitWindowMs,
    max: config.webrtcSignal.rateLimitMax,
  });
  const sessionActionLock = createSessionActionLock();

  io.on('connection', async (socket) => {
    let sessionId;
    try {
      sessionId = await createSession(socket.id);
    } catch (err) {
      console.error(`Failed to create session for socket ${socket.id} (Redis unavailable?):`, err);
      socket.emit('session:error', { message: 'Could not establish a session. Please retry.' });
      socket.disconnect(true);
      return;
    }

    socket.data.sessionId = sessionId;
    socket.emit('session:init', { sessionId });

    // Minted once per connection: STUN (static, public) + a freshly
    // generated, short-lived TURN credential if TURN is configured (see
    // domain/webrtc/iceServers.js — the shared secret used to derive it
    // never leaves the server). Reused for every match/RTCPeerConnection
    // during this connection's lifetime rather than re-minted per call,
    // which is simpler and still rotates naturally on every reconnect.
    socket.emit('ice:servers', { iceServers: buildIceServers() });

    socket.on(
      'presence:heartbeat',
      withValidation(heartbeatPayloadSchema, async (sock) => {
        if (!heartbeatLimiter.allow(sock.id)) {
          return;
        }

        try {
          const refreshed = await refreshSession(sock.data.sessionId, sock.id);
          if (!refreshed) {
            sock.emit('session:expired');
          }
        } catch (err) {
          console.error(`Heartbeat refresh failed for socket ${sock.id}:`, err);
        }
      })(socket)
    );

    registerMatchmakingHandlers(io, socket, sessionActionLock, matchActionLimiter);
    registerChatHandlers(io, socket, chatRateLimiter);
    registerWebrtcHandlers(io, socket, iceRateLimiter, signalRateLimiter);

    socket.on('disconnect', async () => {
      heartbeatLimiter.clear(socket.id);
      chatRateLimiter.clear(socket.id);
      iceRateLimiter.clear(socket.id);
      matchActionLimiter.clear(socket.id);
      signalRateLimiter.clear(socket.id);
      if (socket.data.clientIp) {
        ipLimiter.onDisconnect(socket.data.clientIp);
      }
      try {
        // Must happen BEFORE reading/mutating this session's matchmaking
        // state — see sessionActionLock.js's comment on waitForIdle for
        // why racing an in-flight queue:join/match:next/match:leave here
        // is a real bug, not a theoretical one.
        await sessionActionLock.waitForIdle(socket.id);
        sessionActionLock.clear(socket.id);
        await cleanupMatchmakingOnDisconnect(io, socket.data.sessionId);
        await destroySession(socket.id);
      } catch (err) {
        console.error(`Session cleanup failed on disconnect for socket ${socket.id}:`, err);
      }
    });

    socket.on('error', (err) => {
      console.error(`Socket error [${socket.id}]:`, err);
    });
  });

  return io;
}
