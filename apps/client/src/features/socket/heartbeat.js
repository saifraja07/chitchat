const HEARTBEAT_INTERVAL_MS = 20_000;

/**
 * Starts an application-level heartbeat on a connected socket. Returns
 * a cleanup function. Separate from Socket.IO's own transport-level
 * ping/pong — this one refreshes the server's Redis-backed session TTL,
 * which is a domain concern, not a transport concern.
 */
export function startHeartbeat(socket) {
  const interval = setInterval(() => {
    if (socket.connected) {
      socket.emit('presence:heartbeat', {});
    }
  }, HEARTBEAT_INTERVAL_MS);

  return () => clearInterval(interval);
}
