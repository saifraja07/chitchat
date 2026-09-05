import { randomUUID } from 'node:crypto';
import { getRedisClient } from '../../infra/redis/redisClient.js';
import { config } from '../../config/env.js';
import { getSessionState } from '../session/sessionService.js';

/**
 * All mutating matchmaking operations are backed by the Lua scripts in
 * infra/redis/scripts — each one is a single atomic Redis operation, so
 * two simultaneous requests (two users matching at once, a double-click
 * on Next) can never race each other into an inconsistent state. This
 * module just gives that atomicity a readable JS API and centralizes
 * the "what does this result mean" logic in one place.
 */

const queueKey = (mode) => `queue:${mode}`;
const memberKey = (sessionId) => `queue:member:${sessionId}`;
const sessionKey = (sessionId) => `session:${sessionId}`;
const roomKey = (roomId) => `room:${roomId}`;

/**
 * Attempts to match `sessionId` into `mode`'s pool immediately; if no
 * one is waiting, enqueues it instead. Safe to call repeatedly — if the
 * session is already queued or already in a room, it returns an
 * 'already-active' result instead of creating a duplicate.
 *
 * `role` describes the CALLER's own role in the match: whoever was
 * already waiting becomes 'initiator' (they'll drive WebRTC offer
 * creation once that's wired up in a later phase); whoever just joined
 * and triggered the match becomes 'responder'.
 *
 * @returns {Promise<
 *   | { status: 'matched', roomId: string, peerId: string, role: 'responder' }
 *   | { status: 'waiting' }
 *   | { status: 'already-active', reason: string }
 * >}
 */
export async function joinQueue(sessionId, mode) {
  const redis = getRedisClient();
  const roomId = randomUUID();

  const [code, a, b] = await redis.enqueueOrMatch(
    queueKey(mode),
    memberKey(sessionId),
    sessionKey(sessionId),
    sessionId,
    mode,
    roomId,
    config.matchmaking.queueMemberTtlSeconds,
    config.matchmaking.roomTtlSeconds,
    Date.now()
  );

  if (code === 1) {
    // a = roomId, b = peerId. The peer was already waiting in line, so
    // the peer is the initiator and we (the new arrival) are the responder.
    return { status: 'matched', roomId: a, peerId: b, role: 'responder' };
  }

  if (code === 2) {
    return { status: 'already-active', reason: a };
  }

  return { status: 'waiting' };
}

/**
 * Leaves whatever the session is currently doing — waiting in a queue
 * or in an active room — determined entirely from server-held state,
 * never from anything the client claims. Idempotent: calling this when
 * there's nothing to leave is a harmless no-op, so duplicate Leave/Next
 * clicks or an unmount-time safety call never double-clean or
 * double-notify.
 *
 * @returns {Promise<
 *   | { left: 'room', peerId: string, mode: string }
 *   | { left: 'queue', mode: string }
 *   | { left: 'none' }
 * >}
 */
export async function leaveActive(sessionId) {
  const redis = getRedisClient();
  const { mode, roomId } = await getSessionState(sessionId);

  if (roomId) {
    const result = await redis.leaveRoom(roomKey(roomId), sessionId);
    if (!result) return { left: 'none' }; // peer's simultaneous leave already cleaned it up
    const [peerId, roomMode] = result;
    return { left: 'room', peerId, mode: roomMode };
  }

  if (mode) {
    const removedMode = await redis.leaveQueue(memberKey(sessionId), sessionId);
    if (!removedMode) return { left: 'none' };
    return { left: 'queue', mode: removedMode };
  }

  return { left: 'none' };
}

/**
 * Resolves the sender's OWN current room and peer, derived entirely
 * from server-held session state — never from anything a client
 * claims. Used by chat message relay to guarantee a message can only
 * ever reach the sender's actual current peer in an actually-active
 * room, never an arbitrary room a client might name.
 *
 * Returns null if the sender isn't in a room, or if the room record is
 * gone (a race with a just-completed leave/disconnect on either side).
 *
 * @returns {Promise<{ roomId: string, peerId: string } | null>}
 */
export async function getActiveRoomPeer(sessionId) {
  const redis = getRedisClient();
  const { roomId } = await getSessionState(sessionId);
  if (!roomId) return null;

  const [memberA, memberB] = await redis.hmget(roomKey(roomId), 'memberA', 'memberB');
  if (!memberA || !memberB) return null;

  const peerId = memberA === sessionId ? memberB : memberA;
  return { roomId, peerId };
}

/**
 * "Next": leave the current room (if any) and immediately rejoin the
 * queue for the same mode. Composed from the two atomic primitives
 * above — there's a small gap between them, but that gap can only be
 * raced by another action from the *same* session, which the caller
 * serializes with a per-socket lock (see ws/socketServer.js), so this
 * can't create duplicate sessions from repeated clicks.
 *
 * @returns {Promise<
 *   | { status: 'matched', roomId: string, peerId: string, role: 'responder', leftRoomPeerId: string | null }
 *   | { status: 'waiting', leftRoomPeerId: string | null }
 *   | { status: 'no-active-mode' }
 * >}
 */
export async function nextMatch(sessionId) {
  const { mode, roomId } = await getSessionState(sessionId);

  if (!mode) {
    return { status: 'no-active-mode' };
  }

  let leftRoomPeerId = null;
  if (roomId) {
    const result = await leaveActive(sessionId);
    if (result.left === 'room') {
      leftRoomPeerId = result.peerId;
    }
  }

  const joinResult = await joinQueue(sessionId, mode);
  return { ...joinResult, leftRoomPeerId };
}
