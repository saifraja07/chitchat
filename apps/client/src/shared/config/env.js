/**
 * Centralized environment configuration.
 *
 * Vite only exposes env vars prefixed with VITE_ to client code, and only
 * through import.meta.env. Every other module should import `config` from
 * here instead of touching import.meta.env directly, so there is exactly
 * one place that knows how env vars map to application settings.
 */

function requireEnv(key, fallback) {
  const value = import.meta.env[key];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    // In dev we warn loudly instead of throwing, so the app is still
    // inspectable; in a real production build this should fail the build.
    console.warn(`[config] Missing environment variable: ${key}`);
    return undefined;
  }
  return value;
}

export const config = Object.freeze({
  socketUrl: requireEnv('VITE_SOCKET_URL', 'http://localhost:4000'),
  appEnv: requireEnv('VITE_APP_ENV', 'development'),
});

export default config;
