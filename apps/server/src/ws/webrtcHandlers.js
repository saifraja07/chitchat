import { logger } from '../infra/logger/logger.js';
import { withValidation } from './eventValidation.js';
import { webrtcSdpPayloadSchema, webrtcIceCandidatePayloadSchema } from './schemas.js';
import { getActiveRoomPeer } from '../domain/matchmaking/matchmakingService.js';
import { getSocketIdForSession } from '../domain/session/sessionService.js';

/**
 * Pure signaling relay: the server never inspects, parses, or modifies
 * SDP/ICE content — it only decides WHERE a message is allowed to go,
 * using the same getActiveRoomPeer(sessionId) pattern as chat. None of
 * these payloads carry a room or recipient field, so there is no way
 * for a client to direct signaling at anyone other than its actual
 * current peer in an actually-active room.
 *
 * No media ever passes through the server — once signaling completes,
 * audio/video flows directly between the two browsers over WebRTC.
 */
export function registerWebrtcHandlers(io, socket, iceRateLimiter, signalRateLimiter) {
  async function relay(sessionId, event, payload) {
    const active = await getActiveRoomPeer(sessionId);
    if (!active) {
      // No active room (already left/ended, or never matched) — this is
      // a normal race between in-flight signaling and the match ending
      // (e.g. an ICE candidate that was already on the wire when the
      // peer clicked Next), not something to alarm on. Logged at debug
      // for diagnosability without being noisy in production.
      logger.debug({ socketId: socket.id, event }, 'Dropped signaling message: no active room');
      return;
    }

    const peerSocketId = await getSocketIdForSession(active.peerId);
    if (!peerSocketId) {
      logger.debug({ event, roomId: active.roomId }, 'Dropped signaling message: peer socket gone');
      return;
    }

    io.to(peerSocketId).emit(event, payload);
  }

  socket.on(
    'webrtc:offer',
    withValidation(webrtcSdpPayloadSchema, async (sock, payload) => {
      if (!signalRateLimiter.allow(sock.id)) {
        logger.warn({ socketId: sock.id }, 'WebRTC offer rate limit exceeded');
        return;
      }
      await relay(sock.data.sessionId, 'webrtc:offer', payload);
    })(socket)
  );

  socket.on(
    'webrtc:answer',
    withValidation(webrtcSdpPayloadSchema, async (sock, payload) => {
      if (!signalRateLimiter.allow(sock.id)) {
        logger.warn({ socketId: sock.id }, 'WebRTC answer rate limit exceeded');
        return;
      }
      await relay(sock.data.sessionId, 'webrtc:answer', payload);
    })(socket)
  );

  socket.on(
    'webrtc:ice-candidate',
    withValidation(webrtcIceCandidatePayloadSchema, async (sock, payload) => {
      if (!iceRateLimiter.allow(sock.id)) {
        logger.warn({ socketId: sock.id }, 'ICE candidate rate limit exceeded');
        return;
      }
      await relay(sock.data.sessionId, 'webrtc:ice-candidate', payload);
    })(socket)
  );
}
