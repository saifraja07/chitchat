/**
 * Bounds abuse from a single IP address opening many connections:
 *  - `maxNewConnectionsPerWindow`: caps the RATE of new connections
 *    (protects against connection-flood abuse).
 *  - `maxConcurrent`: caps how many connections from one IP can be open
 *    at once (protects against one address holding open a large chunk
 *    of the connection pool / queue slots simultaneously).
 *
 * Process-local by design, same reasoning as the per-socket rate
 * limiters: this is a soft abuse guard, not authoritative state, so it
 * resets on restart and isn't shared across instances. A determined
 * attacker with many IPs isn't stopped by this — it's meant to catch
 * a single misbehaving client, not to replace real infrastructure-level
 * protection (a reverse proxy or WAF) in front of a real deployment.
 */
export function createIpConnectionLimiter({ windowMs, maxNewConnectionsPerWindow, maxConcurrent }) {
  const recentConnects = new Map(); // ip -> timestamps[]
  const concurrentCounts = new Map(); // ip -> count

  function canConnect(ip) {
    const now = Date.now();
    const windowStart = now - windowMs;

    const recent = (recentConnects.get(ip) ?? []).filter((ts) => ts > windowStart);
    if (recent.length >= maxNewConnectionsPerWindow) {
      return false;
    }

    if ((concurrentCounts.get(ip) ?? 0) >= maxConcurrent) {
      return false;
    }

    recent.push(now);
    recentConnects.set(ip, recent);
    concurrentCounts.set(ip, (concurrentCounts.get(ip) ?? 0) + 1);
    return true;
  }

  function onDisconnect(ip) {
    const count = concurrentCounts.get(ip);
    if (!count) return;
    if (count <= 1) {
      concurrentCounts.delete(ip);
    } else {
      concurrentCounts.set(ip, count - 1);
    }
  }

  return { canConnect, onDisconnect };
}
