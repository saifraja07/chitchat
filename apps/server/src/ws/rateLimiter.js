/**
 * Per-socket, per-event-type rate limiter, backed by process memory.
 *
 * This is deliberately NOT Redis-backed: it's a soft protection against
 * a single misbehaving connection spamming events, not authoritative
 * state. Losing counters on restart or having them be per-instance
 * (rather than global) is fine here — worst case a client gets a fresh
 * allowance after a restart or if a load balancer moves them to a
 * different instance, which is an acceptable tradeoff for something
 * this cheap and low-stakes.
 */
export function createSocketRateLimiter({ windowMs, max }) {
  const hits = new Map(); // socketId -> timestamps[]

  function allow(socketId) {
    const now = Date.now();
    const windowStart = now - windowMs;

    const existing = hits.get(socketId) ?? [];
    const recent = existing.filter((ts) => ts > windowStart);
    recent.push(now);
    hits.set(socketId, recent);

    return recent.length <= max;
  }

  function clear(socketId) {
    hits.delete(socketId);
  }

  return { allow, clear };
}
