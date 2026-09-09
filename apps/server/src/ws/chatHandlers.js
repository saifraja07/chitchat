import { withValidation } from './eventValidation.js';
import { chatMessagePayloadSchema } from './schemas.js';
import { getActiveRoomPeer } from '../domain/matchmaking/matchmakingService.js';
import { getSocketIdForSession } from '../domain/session/sessionService.js';

/**
 * Chat messages are never persisted anywhere — this handler only ever
 * relays a message from one live socket to another via
 * io.to(peerSocketId).emit(...). If neither socket is looking at it at
 * the moment it's sent, it's gone; there is no history to catch up on.
 *
 * The payload carries no room/recipient field at all (see
 * chatMessagePayloadSchema) — every message is routed using
 * getActiveRoomPeer(sessionId), which derives the sender's current room
 * and peer purely from server-held state. A client cannot address a
 * message to any room other than the one the server already knows it's
 * actually in.
 */
export function registerChatHandlers(io, socket, chatRateLimiter) {
  socket.on(
    'chat:message',
    withValidation(
      chatMessagePayloadSchema,
      async (sock, { text }) => {
        if (!chatRateLimiter.allow(sock.id)) {
          sock.emit('chat:error', { message: 'You are sending messages too quickly.' });
          return;
        }

        const sessionId = sock.data.sessionId;
        const active = await getActiveRoomPeer(sessionId);
        if (!active) {
          // Not currently in a room (already left, or the match just
          // ended) — nothing to relay to. Not an error worth logging
          // loudly; this is a normal race between a client's last message
          // and their peer leaving.
          sock.emit('chat:error', { message: 'You are not currently connected to anyone.' });
          return;
        }

        const peerSocketId = await getSocketIdForSession(active.peerId);
        if (!peerSocketId) {
          // Peer's room membership is still recorded but their socket is
          // already gone (race with their own disconnect) — their
          // disconnect cleanup will end this room momentarily.
          return;
        }

        io.to(peerSocketId).emit('chat:message', { text });
      },
      { errorEvent: 'chat:error' }
    )(socket)
  );
}
