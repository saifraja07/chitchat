import { z } from 'zod';

/**
 * Every event a client can emit has a schema here, even ones with no
 * meaningful payload. That keeps the contract explicit and gives every
 * future event (matchmaking, signaling, chat) the same validation path
 * instead of ad-hoc checks scattered in handlers.
 *
 * Nothing the client sends is ever trusted as authoritative state
 * (room/peer/mode/session) — schemas only describe *shape*. Which
 * room a socket belongs to, what mode it's in, etc. is decided and
 * stored server-side (see domain/session), never read from the payload.
 */

// Client sends an empty object on the application-level heartbeat tick.
// Kept as an explicit schema (rather than "no payload") so a future
// field can be added without changing the validation call sites.
export const heartbeatPayloadSchema = z.object({}).strict();

/**
 * @typedef {z.infer<typeof heartbeatPayloadSchema>} HeartbeatPayload
 */

/**
 * Shared by any event that intentionally carries no data (match:next,
 * match:leave). Reusing one schema keeps "no payload" an explicit,
 * validated statement rather than an unchecked assumption.
 */
export const emptyPayloadSchema = z.object({}).strict();

/**
 * The client tells the server which pool it wants to join. This is the
 * ONLY matchmaking input the client ever supplies — no room ID, no peer
 * ID, no "current state" claim. Everything else is derived server-side
 * from the session.
 */
export const queueJoinPayloadSchema = z
  .object({
    mode: z.enum(['video', 'chat']),
  })
  .strict();

/**
 * @typedef {z.infer<typeof queueJoinPayloadSchema>} QueueJoinPayload
 */

const CHAT_MESSAGE_MAX_LENGTH = 500;

// Strips C0/C1 control characters (except the ones normal whitespace
// already covers) before we even look at length/emptiness — a message
// consisting of e.g. null bytes or escape sequences should be treated
// the same as an empty one, not smuggled through as "valid".
function stripControlChars(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/**
 * A single chat message. Deliberately has NO room/peer/recipient field
 * of any kind — which room to relay to is derived entirely server-side
 * from the sender's own session (see domain/matchmaking's
 * getActiveRoomPeer), so there is no field here a client could even
 * attempt to use to target an arbitrary room.
 *
 * Whitespace normalization (trim + collapse internal runs) and control
 * character stripping happen in the schema itself via `transform`, so
 * every caller downstream already has a clean string — "empty after
 * normalization" and "too long" are both schema-level rejections, not
 * something handlers need to re-check.
 */
export const chatMessagePayloadSchema = z
  .object({
    text: z
      .string()
      .max(2000) // generous pre-normalization ceiling, just to bound the work done on the raw string
      .transform((raw) => stripControlChars(raw).trim().replace(/\s+/g, ' '))
      .refine((text) => text.length > 0, { message: 'Message cannot be empty' })
      .refine((text) => text.length <= CHAT_MESSAGE_MAX_LENGTH, {
        message: `Message must be ${CHAT_MESSAGE_MAX_LENGTH} characters or fewer`,
      }),
  })
  .strict();

/**
 * @typedef {z.infer<typeof chatMessagePayloadSchema>} ChatMessagePayload
 */

// SDP blobs are typically a few KB; this is a generous ceiling that
// still bounds the size of what we'll relay without parsing.
const SDP_MAX_LENGTH = 20_000;

/**
 * WebRTC offer/answer relay. Like chat messages, these carry no
 * room/peer field — routing is derived server-side from the sender's
 * session (see domain/matchmaking's getActiveRoomPeer), so signaling
 * can never be aimed at an arbitrary room. The server relays the SDP
 * blob as opaque data; it never parses or modifies it.
 */
export const webrtcSdpPayloadSchema = z
  .object({
    sdp: z.string().min(1).max(SDP_MAX_LENGTH),
  })
  .strict();

/**
 * @typedef {z.infer<typeof webrtcSdpPayloadSchema>} WebrtcSdpPayload
 */

const iceCandidateSchema = z
  .object({
    candidate: z.string().max(2000),
    sdpMid: z.string().max(64).nullable().optional(),
    sdpMLineIndex: z.number().int().nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  })
  .strict();

export const webrtcIceCandidatePayloadSchema = z
  .object({
    candidate: iceCandidateSchema,
  })
  .strict();

/**
 * @typedef {z.infer<typeof webrtcIceCandidatePayloadSchema>} WebrtcIceCandidatePayload
 */
