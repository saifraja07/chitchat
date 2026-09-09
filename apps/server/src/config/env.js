import 'dotenv/config';

/**
 * Single source of truth for environment configuration.
 *
 * Every other module reads settings from `config`, never from
 * process.env directly — that keeps validation, defaults, and naming
 * in exactly one place.
 */

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toList(value, fallback) {
  if (!value) return fallback;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

const requiredInProduction = ['REDIS_URL', 'CORS_ORIGINS'];

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toInt(process.env.PORT, 4000),

  corsOrigins: toList(process.env.CORS_ORIGINS, [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]),

  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  redisConnectTimeoutMs: toInt(process.env.REDIS_CONNECT_TIMEOUT_MS, 5000),

  matchmaking: {
    // Backstop only — normal cleanup happens explicitly on leave/next/disconnect.
    queueMemberTtlSeconds: toInt(process.env.QUEUE_MEMBER_TTL_SECONDS, 120),
    roomTtlSeconds: toInt(process.env.ROOM_TTL_SECONDS, 21_600), // 6h
  },

  chat: {
    rateLimitWindowMs: toInt(process.env.CHAT_RATE_LIMIT_WINDOW_MS, 10_000),
    rateLimitMax: toInt(process.env.CHAT_RATE_LIMIT_MAX, 15),
  },

  connectionLimit: {
    windowMs: toInt(process.env.IP_CONNECT_RATE_WINDOW_MS, 60_000),
    maxNewConnectionsPerWindow: toInt(process.env.IP_CONNECT_RATE_MAX, 30),
    maxConcurrent: toInt(process.env.IP_CONNECT_MAX_CONCURRENT, 20),
  },

  matchAction: {
    // Bounds queue:join / match:next / match:leave — generous enough for
    // legitimate rapid Next-clicking, tight enough to blunt automated abuse.
    rateLimitWindowMs: toInt(process.env.MATCH_ACTION_RATE_LIMIT_WINDOW_MS, 10_000),
    rateLimitMax: toInt(process.env.MATCH_ACTION_RATE_LIMIT_MAX, 20),
  },

  webrtcSignal: {
    // Offer/answer are ~1-2 per call setup; this bounds repeated
    // renegotiation attempts without limiting normal use.
    rateLimitWindowMs: toInt(process.env.WEBRTC_SIGNAL_RATE_LIMIT_WINDOW_MS, 10_000),
    rateLimitMax: toInt(process.env.WEBRTC_SIGNAL_RATE_LIMIT_MAX, 20),
  },

  ice: {
    // STUN URLs are public information — safe to ship as static config.
    stunUrls: toList(process.env.STUN_URLS, ['stun:stun.l.google.com:19302']),
    // TURN is optional: if unset, the server simply omits TURN from the
    // ICE server list it hands to clients (STUN-only, same as before
    // this phase). TURN_SHARED_SECRET is NEVER sent to the client —
    // only short-lived username/credential pairs derived from it are.
    turnUrls: toList(process.env.TURN_URLS, []),
    turnSharedSecret: process.env.TURN_SHARED_SECRET || null,
    turnCredentialTtlSeconds: toInt(process.env.TURN_CREDENTIAL_TTL_SECONDS, 3600),
  },

  rateLimit: {
    windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    max: toInt(process.env.RATE_LIMIT_MAX, 100),
  },

  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || '10kb',

  shutdownTimeoutMs: toInt(process.env.SHUTDOWN_TIMEOUT_MS, 10_000),
});

export function assertProductionConfig() {
  if (config.nodeEnv !== 'production') return;

  const missing = requiredInProduction.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables in production: ${missing.join(', ')}`
    );
  }
}

export default config;
