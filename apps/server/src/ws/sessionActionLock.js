const IDLE_WAIT_TIMEOUT_MS = 5000;

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
 *
 * CRITICAL: disconnect cleanup must go through `waitForIdle` before
 * running its own matchmaking cleanup. Without this, a socket
 * disconnecting WHILE its own match:next (say) is still mid-flight —
 * genuinely possible: the event was received and its async handler
 * started awaiting Redis calls, then the network dropped — would let
 * the disconnect handler's cleanup and the in-flight action mutate
 * Redis concurrently and completely unguarded, since disconnect itself
 * was never routed through this lock. Concretely, this could match a
 * brand new peer with a session whose socket is already gone (they'd
 * see "connected" to someone who never responds), or leave a queue
 * entry for a session that no longer exists. `waitForIdle` closes that
 * gap by making disconnect cleanup always run strictly after whatever
 * was already in flight finishes.
 */
export function createSessionActionLock() {
  const busy = new Map(); // socketId -> Promise<void> (the in-flight action)

  function withLock(socket, listener) {
    return async (rawPayload) => {
      if (busy.has(socket.id)) {
        return;
      }

      const promise = (async () => {
        try {
          await listener(rawPayload);
        } finally {
          if (busy.get(socket.id) === promise) {
            busy.delete(socket.id);
          }
        }
      })();

      busy.set(socket.id, promise);
      await promise;
    };
  }

  /**
   * Waits for any currently in-flight action for this socket to finish
   * (bounded — a handler stuck far longer than any real Redis call
   * should take must not block disconnect cleanup forever). A rejected
   * in-flight action is swallowed here; the handler itself already logs
   * its own errors.
   */
  async function waitForIdle(socketId) {
    const pending = busy.get(socketId);
    if (!pending) return;

    await Promise.race([
      pending.catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, IDLE_WAIT_TIMEOUT_MS)),
    ]);
  }

  function clear(socketId) {
    busy.delete(socketId);
  }

  return { withLock, waitForIdle, clear };
}
