import { useEffect } from 'react';

/**
 * Dev-only: mirrors matchmaking status onto window.__relayDebug so
 * automated UI tests can read it without adding test-only DOM markup.
 * Dead-code-eliminated from production builds via import.meta.env.DEV.
 */
export function useMatchmakingDebug(matchStatus, room) {
  useEffect(() => {
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      window.__relayDebug = {
        ...window.__relayDebug,
        matchStatus,
        roomId: room?.roomId ?? null,
        role: room?.role ?? null,
      };
    }
  }, [matchStatus, room]);
}
