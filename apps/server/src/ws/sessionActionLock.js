import { logger } from '../infra/logger/logger.js';

/**
 * Serializes handling of session-mutating events (queue:join,
 * match:next, match:leave) per socket. Without this, a double-click or
 * a client retry sent before the first response arrives could run two
 * matchmaking operations concurrently for the same session — each one
 * individually atomic in Redis, but the *pair* of them racing is still
 * something we'd rather just not allow, since it lets a session end up
 * being acted on twice for what the user experienced as one click.
 *
 * While a socket has an operation in flight, further events of this
 * kind are dropped (logged, not queued) — the client already has a
 * pending request outstanding and will get a server-driven state update
 * (match:found / queue:joined / match:ended) when it resolves.
 *
 * `withLock` wraps an already-socket-bound listener — i.e. a function
 * of shape (rawPayload) => Promise<void>, the same shape Socket.IO
 * itself expects for `socket.on(event, listener)` — and returns a
 * listener of that same shape, keyed on the given socket's id.
 */
export function createSessionActionLock() {
  const busy = new Set();

  function withLock(socket, listener) {
    return async (rawPayload) => {
      if (busy.has(socket.id)) {
        logger.debug({ socketId: socket.id }, 'Dropped event: session action already in flight');
        return;
      }
      busy.add(socket.id);
      try {
        await listener(rawPayload);
      } finally {
        busy.delete(socket.id);
      }
    };
  }

  function clear(socketId) {
    busy.delete(socketId);
  }

  return { withLock, clear };
}
