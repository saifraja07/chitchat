# Relay — backend

Node.js + Express + Socket.IO backend for the Relay random stranger
video/chat app. Handles matchmaking, WebRTC signaling relay, and chat
message relay. Never touches media (audio/video flows peer-to-peer once
signaling completes) and never persists chat history.

## Running locally

```bash
cp .env.example .env      # edit if your Redis isn't on localhost:6379
npm install
npm run dev                # or `npm start` for a non-watching run
```

Requires a running Redis instance (see `docker-compose.yml` at the repo
root for local dev, or run `redis-server` directly).

## Environment variables

All variables are documented with defaults in `.env.example`. Summary
by category:

| Category | Variables | Notes |
|---|---|---|
| Core | `NODE_ENV`, `PORT` | `NODE_ENV=production` enables stricter startup checks |
| CORS | `CORS_ORIGINS` | **Required in production.** Comma-separated allowed frontend origins |
| Redis | `REDIS_URL`, `REDIS_CONNECT_TIMEOUT_MS` | **Required in production.** Supports `redis://:password@host:port` and `rediss://` for TLS |
| Logging | `LOG_LEVEL` | `trace`..`fatal`; pretty-printed in development, structured JSON otherwise |
| HTTP hardening | `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `REQUEST_BODY_LIMIT` | Applies to the HTTP API surface (health checks etc.), not WebSocket events |
| Shutdown | `SHUTDOWN_TIMEOUT_MS` | Force-exit if graceful shutdown hangs |
| Matchmaking TTLs | `QUEUE_MEMBER_TTL_SECONDS`, `ROOM_TTL_SECONDS` | Safety-net expirations — explicit cleanup is the primary mechanism; room TTL is refreshed on heartbeat while a room is active |
| Chat rate limit | `CHAT_RATE_LIMIT_WINDOW_MS`, `CHAT_RATE_LIMIT_MAX` | Per-socket |
| Matchmaking action rate limit | `MATCH_ACTION_RATE_LIMIT_WINDOW_MS`, `MATCH_ACTION_RATE_LIMIT_MAX` | Bounds `queue:join`/`match:next`/`match:leave` spam, per socket |
| WebRTC signal rate limit | `WEBRTC_SIGNAL_RATE_LIMIT_WINDOW_MS`, `WEBRTC_SIGNAL_RATE_LIMIT_MAX` | Bounds offer/answer/ICE spam, per socket |
| Connection limiting | `IP_CONNECT_RATE_WINDOW_MS`, `IP_CONNECT_RATE_MAX`, `IP_CONNECT_MAX_CONCURRENT` | Process-local per-IP guard — see limitations below |
| Observability | `STATS_INTERVAL_MS` | Periodic queue-depth/active-room log snapshot |

## Architecture at a glance

- **Sessions**: anonymous, server-generated (`crypto.randomUUID()`),
  Redis-backed with a short TTL refreshed by client heartbeat. Never
  derived from IP or fingerprint. Nothing persists after disconnect.
- **Matchmaking**: two independent Redis-list queues (video/chat), paired
  via atomic Lua scripts (`src/infra/redis/scripts/`) so concurrent join
  attempts can never race into an inconsistent state.
- **Signaling**: pure relay — the server never parses SDP/ICE content,
  only decides whether the sender is allowed to reach a given peer
  (derived from server-held room state, never from client-supplied
  room/peer fields).
- **Chat**: relay-only, never persisted. Same room-derivation pattern as
  signaling.
- **Horizontal scaling**: `@socket.io/redis-adapter` makes
  `io.to(socketId).emit(...)` work correctly across multiple backend
  instances sharing one Redis — verified with two genuinely separate
  processes in testing, not just claimed.

## Deployment

Designed to run behind a reverse proxy (nginx, Caddy, a cloud load
balancer, etc.) terminating TLS, with `NODE_ENV=production`. `trust
proxy` is enabled in the Express app so client IPs and protocol are read
correctly from `X-Forwarded-*` headers.

No process-local state is required for correctness — all matchmaking,
session, and room state lives in Redis, so any number of backend
instances can run behind a load balancer with no sticky-session
requirement. The two exceptions are deliberately soft, per-instance-only
guards (rate limiters, the per-IP connection limiter) that reset on
restart and aren't shared across instances by design — see limitations.

Health endpoints for orchestration:
- `GET /health/live` — process is up
- `GET /health/ready` — process is up AND Redis is reachable (503 when
  degraded)

## WebRTC connectivity: STUN, TURN, and bandwidth

### How ICE server config reaches the client

STUN and TURN server info is sent from the backend to each client over
Socket.IO right after connecting (`ice:servers` event) — it is **not**
baked into the frontend build. This matters specifically for TURN: a
TURN credential embedded in a static client bundle would be a
long-lived secret anyone could extract from the page source and reuse
indefinitely. Instead:

- STUN URLs are static and public (there's nothing sensitive about "here
  is a server that echoes back your public IP") — configured via
  `STUN_URLS`.
- TURN, if configured (`TURN_URLS` + `TURN_SHARED_SECRET`), uses the
  time-limited credential scheme coturn's `use-auth-secret` mode
  implements: the server computes `username = "<unix-expiry>"` and
  `credential = base64(HMAC-SHA1(sharedSecret, username))` fresh for
  every connection (`src/domain/webrtc/iceServers.js`). The shared
  secret itself never leaves the server; only the derived,
  time-bounded pair does. A leaked credential expires
  (`TURN_CREDENTIAL_TTL_SECONDS`, default 1h) and grants nothing beyond
  relaying media through that one TURN allocation for that window — it
  cannot be used to derive the secret or mint further credentials.

This was verified against a real local coturn instance during
development (not just reasoned about): a genuine `ALLOCATE` /
`CREATE_PERMISSION` / `CHANNEL_BIND` exchange, with `iceTransportPolicy:
'relay'` forced client-side so host/server-reflexive candidates were
unavailable — the connection only succeeded via actual TURN relay,
confirming the whole pipeline (server-minted credential → client ICE
config → coturn authentication → relay of real audio/video tracks)
works end to end, not just that the code looks right in isolation.

### Bandwidth implications

STUN is nearly free — it's a handful of small request/response packets
used only to discover candidate addresses; no media ever passes through
a STUN server. **TURN is different: when a call falls back to TURN, the
TURN server relays the full audio+video stream in both directions for
the entire call.** Concretely:

- A typical two-way video call (both directions) commonly runs
  somewhere in the 1–3 Mbps combined range depending on resolution and
  encoder settings — that's the bandwidth the TURN server carries, per
  relayed call, for the call's whole duration.
- Industry figures commonly cited for real-world WebRTC deployments put
  the fraction of calls that actually need TURN relay (as opposed to
  succeeding via direct P2P) at roughly 10–20%, driven mostly by
  symmetric NAT and restrictive corporate/mobile-carrier firewalls. The
  exact number varies a lot by deployment's user base.
- This means TURN bandwidth costs scale with **(concurrent relayed
  calls) × (per-call bitrate) × 2** (both legs of the relay), not with
  total user count — most calls that succeed via direct P2P cost the
  TURN server nothing.
- For capacity planning: budget TURN server bandwidth for the
  percentage of concurrent calls you expect to need relay, at your
  target video bitrate, doubled for both directions. A TURN deployment
  that's undersized on bandwidth degrades those specific calls (packet
  loss, quality drops) rather than failing outright.

### TURN infrastructure requirements

Not provided by this repository — needs to be provisioned separately:

- A coturn instance (or compatible TURN provider) with a public IP,
  UDP and TCP listeners on the TURN port (3478 conventionally, plus
  5349 for `turns:`/TLS), and the relay port range
  (`min-port`/`max-port` in coturn) open through any firewall/security
  group.
- `use-auth-secret` + `static-auth-secret` configured to match
  `TURN_SHARED_SECRET` exactly — this is the piece that makes the
  time-limited credential scheme work; without it, coturn expects
  long-term static username/password pairs instead, which this backend
  does not generate.
- TLS (`turns:`) if you want TURN traffic itself encrypted end-to-end
  to the relay (recommended for production; the media itself is already
  SRTP-encrypted regardless, but `turns:` also hides that a TURN relay
  is being used from network observers).
- Sizing: CPU/memory needs for coturn itself are modest (it's mostly
  I/O-bound); bandwidth is the real capacity constraint — see above.
- Geographic placement matters for latency: a TURN server far from both
  peers adds round-trip latency to every relayed packet. A production
  deployment serving a geographically spread user base would want
  TURN servers in multiple regions, with `TURN_URLS` listing servers
  appropriate to where the request originates (this backend currently
  sends the same static `TURN_URLS` list to every client — geo-routing
  TURN servers is not implemented here).

## Known limitations (honest list)

- **Rate limiters and the per-IP connection limiter are process-local.**
  In a multi-instance deployment, a client hitting different instances
  (round-robin, no sticky sessions) effectively gets a separate
  allowance per instance. This is a deliberate simplicity tradeoff
  documented in the code — a real production deployment should also
  have IP-based rate limiting at the reverse proxy / WAF layer, which
  this doesn't replace.
- **No TURN server is deployed by default; the code supports one but you
  must provision it.** Without `TURN_URLS`/`TURN_SHARED_SECRET` set, the
  app runs STUN-only exactly as it did before this capability was added
  — which still works for most direct-P2P-capable networks, but peers
  behind symmetric NATs or restrictive firewalls will fail to connect.
  See "WebRTC connectivity" above for what's actually required to stand
  one up.
- **TURN relay was verified against a real local coturn instance, but
  only on loopback — not across genuinely different real-world
  networks.** This sandboxed environment has a single network path with
  no ability to simulate distinct Wi-Fi networks, mobile data, or a
  genuinely restrictive corporate/carrier NAT. What WAS verified: a real
  coturn server, real HMAC credential generation and coturn
  authentication (`ALLOCATE`/`CREATE_PERMISSION`/`CHANNEL_BIND` all
  succeeding), and real audio/video tracks flowing through the relay
  with direct candidates forcibly disabled (`iceTransportPolicy:
  'relay'`) — this proves the mechanism works end-to-end. What remains
  unverified without real infrastructure: actual behavior across
  genuinely diverse networks (different ISPs, mobile carriers, VPNs,
  corporate firewalls), latency/quality under real TURN relay distance,
  and desktop↔mobile combinations on real devices. A discovered-and-fixed
  bug from this testing: when ICE candidate gathering itself never
  completes (e.g. every TURN candidate source rejected), Chrome's native
  `connectionState` can get stuck at `'new'` indefinitely rather than
  ever reaching `'failed'` — the app now has its own 20-second
  connection-setup watchdog (`useWebRTCPeerConnection.js`) that declares
  failure independently of the browser's native state in that case, so
  a user is never stranded on an infinite "Connecting…" screen.
- **No authentication or abuse-reporting system.** Anyone can connect
  and use the service; there's no reporting, blocking, or moderation.
  This was explicit V1 scope, not an oversight — see the project's
  Phase 0 architecture notes for the reasoning and the recommendation to
  prioritize moderation before any real user traffic.
- **Stale Redis queue-list entries are not proactively swept.** A
  session that disconnects ungracefully (process crash between
  operations) leaves its queue-list entry to be discarded lazily the
  next time someone joins that mode's queue (see `enqueueOrMatch.lua`'s
  stale-entry handling), not by a background job. In practice this
  self-heals under normal traffic; under very low traffic a few stale
  entries could sit in a queue list until the next join. This is a
  known, low-severity tradeoff, not a correctness bug — the entries
  don't affect matching correctness, only (negligibly) list length.
- **Single-region Redis.** No multi-region replication/failover story;
  Redis is a single point of failure for the whole matchmaking/session
  layer. The app degrades gracefully (health check reports 503, no
  crash, automatic recovery once Redis returns — verified by killing
  and restarting Redis mid-session), but there's no HA Redis setup here.
- **No load testing at scale.** Verified correctness under concurrent
  load in the 2-11 simultaneous user range (multi-tab Playwright tests)
  and confirmed two-process horizontal scaling works, but nothing here
  has been load-tested at production-representative traffic volumes.
