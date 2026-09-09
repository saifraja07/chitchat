import { config } from '../../config/env.js';

/**
 * Runs before a socket connection is accepted.
 *
 * IMPORTANT: Socket.IO's `cors` server option does NOT actually restrict
 * WebSocket connections — CORS is a browser-enforced mechanism that only
 * applies to XHR/fetch (and therefore Socket.IO's HTTP long-polling
 * transport). The WebSocket protocol itself has no same-origin
 * restriction; a browser will happily let a page open a WebSocket to any
 * origin, and a non-browser client can set any Origin header it likes
 * regardless. Since our client connects with `transports: ['websocket']`
 * only, the `cors` option on the Socket.IO server config is effectively
 * decorative for us — verified directly against this server: a raw
 * WebSocket upgrade with a disallowed Origin header still succeeds.
 *
 * So origin checking has to happen explicitly, here, rather than being
 * left to Socket.IO's cors option. This doesn't stop a deliberately
 * malicious non-browser client (which can lie about its Origin), but it
 * does stop the case CORS is actually meant to cover: a malicious
 * website's JS running in a visiting browser trying to make that
 * browser's WebSocket connect to us on the page's behalf.
 *
 * Also enforces the per-IP connection limiter (see
 * ipConnectionLimiter.js) — a coarse guard against one address flooding
 * the server with connections. `trust proxy` semantics mirror the HTTP
 * app: `handshake.address` already reflects X-Forwarded-For when
 * Engine.IO is configured behind a trusted proxy, which is Socket.IO's
 * default behavior when the underlying HTTP server has trust proxy set.
 */
export function createConnectionValidation(ipLimiter) {
  return function connectionValidation(socket, next) {
    const { handshake } = socket;

    if (!handshake || typeof handshake.address !== 'string') {
      return next(new Error('Invalid connection'));
    }

    const origin = handshake.headers?.origin;
    // Non-browser clients (e.g. server-to-server, native apps) may not send
    // an Origin header at all — that's normal and not itself a CORS
    // concern, so only reject when an Origin IS present and doesn't match.
    if (origin && !config.corsOrigins.includes(origin)) {
      return next(new Error('Origin not allowed'));
    }

    const ip = handshake.address;
    if (!ipLimiter.canConnect(ip)) {
      return next(new Error('Too many connections'));
    }

    socket.data.clientIp = ip;
    return next();
  };
}
