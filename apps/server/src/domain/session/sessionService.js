import { randomUUID } from 'node:crypto';
import { getRedisClient } from '../../infra/redis/redisClient.js';
import { config } from '../../config/env.js';

/**
 * Sessions are the server's authoritative notion of "who is this
 * connection" — anonymous, temporary, and never derived from anything
 * the client supplies (no IP, no fingerprint, no client-chosen ID).
 *
 * Redis is the source of truth so this survives horizontal scaling:
 * any backend instance can look up a session, not just the one that
 * created it.
 *
 * Later phases (matchmaking, rooms) attach more fields to this same
 * session hash rather than inventing a parallel store.
 */

const SESSION_TTL_SECONDS = 60; // refreshed by heartbeat; backstop for crashed/abandoned sockets
const ROOM_TTL_SECONDS = config.matchmaking.roomTtlSeconds;
const SESSION_KEY_PREFIX = 'session:';
const SOCKET_KEY_PREFIX = 'socket:';

const sessionKey = (sessionId) => `${SESSION_KEY_PREFIX}${sessionId}`;
const socketKey = (socketId) => `${SOCKET_KEY_PREFIX}${socketId}`;

/**
 * Creates a new anonymous session for a freshly connected socket.
 * Returns the generated sessionId.
 */
export async function createSession(socketId) {
  const sessionId = randomUUID();
  const redis = getRedisClient();

  const now = Date.now();

  await redis
    .multi()
    .hset(sessionKey(sessionId), {
      socketId,
      connectedAt: now,
    })
    .expire(sessionKey(sessionId), SESSION_TTL_SECONDS)
    .set(socketKey(socketId), sessionId, 'EX', SESSION_TTL_SECONDS)
    .exec();

  return sessionId;
}

/**
 * Refreshes a session's TTL in response to an application-level
 * heartbeat. Returns false if the session no longer exists (e.g. it
 * already expired), so the caller can tell the client to reconnect
 * fresh rather than silently doing nothing.
 *
 * Also refreshes the session's active room's TTL, if it has one. The
 * room TTL is a long safety-net (see matchmaking config) meant only to
 * catch crashed/orphaned rooms that explicit cleanup missed — without
 * this refresh, a genuinely long-running call or chat would eventually
 * have its room silently expire out from under it even though both
 * peers are still actively connected.
 */
export async function refreshSession(sessionId, socketId) {
  const redis = getRedisClient();

  const exists = await redis.exists(sessionKey(sessionId));
  if (!exists) return false;

  const roomId = await redis.hget(sessionKey(sessionId), 'roomId');

  const multi = redis
    .multi()
    .expire(sessionKey(sessionId), SESSION_TTL_SECONDS)
    .expire(socketKey(socketId), SESSION_TTL_SECONDS);

  if (roomId) {
    multi.expire(`room:${roomId}`, ROOM_TTL_SECONDS);
  }

  await multi.exec();

  return true;
}

/**
 * Looks up the session ID for a given socket, if any.
 */
export async function getSessionIdForSocket(socketId) {
  const redis = getRedisClient();
  return redis.get(socketKey(socketId));
}

/**
 * Looks up the live socketId currently associated with a session, if
 * any. Used to route matchmaking notifications (match:found,
 * match:ended) to a peer regardless of which backend instance their
 * socket is actually connected to — the Socket.IO Redis adapter handles
 * the actual cross-instance delivery once we have the target socketId.
 */
export async function getSocketIdForSession(sessionId) {
  const redis = getRedisClient();
  return redis.hget(sessionKey(sessionId), 'socketId');
}

/**
 * Full current state of a session: which mode it joined with (if any)
 * and which room it's in (if any). Used by matchmaking handlers to
 * decide what "leave" or "next" should actually do, instead of trusting
 * anything the client claims about its own state.
 */
export async function getSessionState(sessionId) {
  const redis = getRedisClient();
  const [mode, roomId] = await redis.hmget(sessionKey(sessionId), 'mode', 'roomId');
  return { mode, roomId };
}

/**
 * Cleans up a session on disconnect. Explicit deletion happens here so
 * cleanup doesn't depend solely on TTL expiry (TTL is only the
 * backstop for crashes/ungraceful exits).
 */
export async function destroySession(socketId) {
  const redis = getRedisClient();

  const sessionId = await redis.get(socketKey(socketId));
  if (!sessionId) return;

  await redis.multi().del(sessionKey(sessionId)).del(socketKey(socketId)).exec();
}
