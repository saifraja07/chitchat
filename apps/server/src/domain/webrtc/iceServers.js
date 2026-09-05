import { createHmac } from 'node:crypto';
import { config } from '../../config/env.js';

/**
 * TURN credentials use the same time-limited scheme coturn's
 * `use-auth-secret` mode implements (also supported by several hosted
 * TURN providers under names like "REST API" or "HMAC" auth) — RFC
 * 5389-adjacent, not a formal standard, but a widely interoperable
 * convention:
 *
 *   username  = "<expiryUnixTimestamp>"
 *   credential = base64( HMAC-SHA1( sharedSecret, username ) )
 *
 * The shared secret NEVER leaves the server. Only the derived
 * username/credential pair — valid until the embedded expiry — is ever
 * sent to a client. A leaked credential is worthless after it expires
 * and grants no access to anything beyond relaying media through the
 * TURN server for that one window; it cannot be used to derive the
 * secret or mint further credentials.
 */
function generateTurnCredential(sharedSecret, ttlSeconds) {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = String(expiry);
  const credential = createHmac('sha1', sharedSecret).update(username).digest('base64');
  return { username, credential };
}

/**
 * Builds the ICE server list for a client. STUN entries are static
 * (STUN URLs are public information — there's nothing secret about
 * "here is a server that tells you your own public IP"). TURN entries,
 * if TURN is configured, get a freshly minted short-lived credential
 * every time this is called — each connecting client gets its own,
 * scoped to `turnCredentialTtlSeconds`.
 *
 * Returns STUN-only if TURN isn't configured — this is a valid,
 * supported configuration (matches Phase 6's original STUN-only setup),
 * not an error state. Direct P2P still works for most network
 * conditions; only calls that would otherwise need relay are affected.
 */
export function buildIceServers() {
  const servers = config.ice.stunUrls.map((urls) => ({ urls }));

  if (config.ice.turnUrls.length > 0 && config.ice.turnSharedSecret) {
    const { username, credential } = generateTurnCredential(
      config.ice.turnSharedSecret,
      config.ice.turnCredentialTtlSeconds
    );
    servers.push({
      urls: config.ice.turnUrls,
      username,
      credential,
    });
  }

  return servers;
}

export function isTurnConfigured() {
  return config.ice.turnUrls.length > 0 && !!config.ice.turnSharedSecret;
}
