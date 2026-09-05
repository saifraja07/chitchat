import { logger } from '../infra/logger/logger.js';
import { withValidation } from './eventValidation.js';
import { queueJoinPayloadSchema, emptyPayloadSchema } from './schemas.js';
import { joinQueue, leaveActive, nextMatch } from '../domain/matchmaking/matchmakingService.js';
import { getSocketIdForSession } from '../domain/session/sessionService.js';

/**
 * Sends a socket event to a session's live socket, wherever it's
 * connected. `io.to(socketId)` works across backend instances once the
 * Socket.IO Redis adapter is attached (see socketServer.js) — every
 * socket implicitly belongs to a room named after its own id, so this
 * needs no extra room-management code of our own.
 */
async function notifySession(io, sessionId, event, payload) {
  const socketId = await getSocketIdForSession(sessionId);
  if (!socketId) return; // peer already disconnected; nothing to notify
  io.to(socketId).emit(event, payload);
}

export function registerMatchmakingHandlers(io, socket, sessionActionLock, matchActionLimiter) {
  socket.on(
    'queue:join',
    sessionActionLock.withLock(
      socket,
      withValidation(
        queueJoinPayloadSchema,
        async (sock, { mode }) => {
          if (!matchActionLimiter.allow(sock.id)) {
            logger.warn({ socketId: sock.id }, 'Matchmaking action rate limit exceeded');
            sock.emit('queue:error', { message: 'Too many requests. Please slow down.' });
            return;
          }

          const sessionId = sock.data.sessionId;
          const result = await joinQueue(sessionId, mode);

          if (result.status === 'matched') {
            sock.emit('match:found', { roomId: result.roomId, role: result.role });
            await notifySession(io, result.peerId, 'match:found', {
              roomId: result.roomId,
              role: 'initiator',
            });
            logger.info({ roomId: result.roomId, mode }, 'Room created (match found)');
          } else if (result.status === 'waiting') {
            sock.emit('queue:joined', { mode });
          } else {
            sock.emit('queue:error', { message: 'You already have an active session.' });
          }
        },
        { errorEvent: 'queue:error' }
      )(socket)
    )
  );

  socket.on(
    'match:next',
    sessionActionLock.withLock(
      socket,
      withValidation(
        emptyPayloadSchema,
        async (sock) => {
          if (!matchActionLimiter.allow(sock.id)) {
            logger.warn({ socketId: sock.id }, 'Matchmaking action rate limit exceeded');
            sock.emit('queue:error', { message: 'Too many requests. Please slow down.' });
            return;
          }

          const sessionId = sock.data.sessionId;
          const result = await nextMatch(sessionId);

          if (result.leftRoomPeerId) {
            await notifySession(io, result.leftRoomPeerId, 'match:ended', { reason: 'peer_left' });
            logger.info('Room closed (Next)');
          }

          if (result.status === 'matched') {
            sock.emit('match:found', { roomId: result.roomId, role: result.role });
            await notifySession(io, result.peerId, 'match:found', {
              roomId: result.roomId,
              role: 'initiator',
            });
            logger.info({ roomId: result.roomId }, 'Room created (match found via Next)');
          } else if (result.status === 'waiting') {
            sock.emit('queue:joined', { mode: null });
          } else if (result.status === 'no-active-mode') {
            sock.emit('queue:error', { message: 'Join a mode before requesting Next.' });
          }
        },
        { errorEvent: 'queue:error' }
      )(socket)
    )
  );

  socket.on(
    'match:leave',
    sessionActionLock.withLock(
      socket,
      withValidation(emptyPayloadSchema, async (sock) => {
        const sessionId = sock.data.sessionId;
        const result = await leaveActive(sessionId);

        if (result.left === 'room') {
          await notifySession(io, result.peerId, 'match:ended', { reason: 'peer_left' });
          logger.info('Room closed (Leave)');
        }
      })(socket)
    )
  );
}

/**
 * Called from the disconnect handler. Cleans up any queue/room state
 * for a session that's going away, notifying its peer if it was in a
 * room. Must run BEFORE the session record itself is deleted, since it
 * needs to read the session's current mode/room to know what to clean.
 */
export async function cleanupMatchmakingOnDisconnect(io, sessionId) {
  const result = await leaveActive(sessionId);
  if (result.left === 'room') {
    await notifySession(io, result.peerId, 'match:ended', { reason: 'peer_disconnected' });
    logger.info('Room closed (peer disconnected)');
  }
  return result;
}
