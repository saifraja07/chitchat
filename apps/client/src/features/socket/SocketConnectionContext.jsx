import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getSocket } from './socketClient.js';
import { startHeartbeat } from './heartbeat.js';

/**
 * `status` values:
 *  - 'connecting'    initial connection attempt in progress
 *  - 'connected'     live and ready
 *  - 'reconnecting'  was connected, transport dropped, retrying
 *  - 'error'         connect attempt failed (server unreachable, etc.)
 *  - 'disconnected'  intentionally disconnected, not retrying
 *
 * This is the ONLY place in the app that attaches listeners to the
 * socket's connection lifecycle. Components read state via
 * useSocketConnection() instead of subscribing themselves — that's
 * what keeps listeners from being scattered across random components
 * and avoids duplicate-listener bugs when components mount/unmount.
 */
const SocketConnectionContext = createContext(null);

export function SocketConnectionProvider({ children }) {
  const [status, setStatus] = useState('connecting');
  const [sessionId, setSessionId] = useState(null);
  const [iceServers, setIceServers] = useState(null);
  const stopHeartbeatRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();

    const handleConnect = () => {
      window.__relayConnectCount = (window.__relayConnectCount || 0) + 1;
      setStatus('connected');
      stopHeartbeatRef.current?.();
      stopHeartbeatRef.current = startHeartbeat(socket);
    };

    const handleDisconnect = (reason) => {
      stopHeartbeatRef.current?.();
      stopHeartbeatRef.current = null;
      setSessionId(null);
      setIceServers(null);
      // 'io client disconnect' means we called socket.disconnect()
      // ourselves — anything else is the transport dropping, which
      // socket.io-client will automatically try to recover from.
      setStatus(reason === 'io client disconnect' ? 'disconnected' : 'reconnecting');
    };

    const handleConnectError = () => setStatus('error');
    const handleReconnectAttempt = () => setStatus('reconnecting');
    const handleReconnectFailed = () => setStatus('error');

    const handleSessionInit = ({ sessionId: id }) => setSessionId(id);
    const handleSessionExpired = () => setSessionId(null);
    // Minted fresh per connection by the server (STUN + a short-lived
    // TURN credential, if TURN is configured server-side) — see
    // server/src/domain/webrtc/iceServers.js. Reused for every match
    // during this connection's lifetime.
    const handleIceServers = ({ iceServers: servers }) => setIceServers(servers);

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.io.on('reconnect_attempt', handleReconnectAttempt);
    socket.io.on('reconnect_failed', handleReconnectFailed);
    socket.on('session:init', handleSessionInit);
    socket.on('session:expired', handleSessionExpired);
    socket.on('ice:servers', handleIceServers);

    socket.connect();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.io.off('reconnect_attempt', handleReconnectAttempt);
      socket.io.off('reconnect_failed', handleReconnectFailed);
      socket.off('session:init', handleSessionInit);
      socket.off('session:expired', handleSessionExpired);
      socket.off('ice:servers', handleIceServers);
      stopHeartbeatRef.current?.();
    };
  }, []);

  const reconnect = () => {
    const socket = getSocket();
    if (!socket.connected) {
      setStatus('connecting');
      socket.connect();
    }
  };

  // Dev-only inspection hook (e.g. for automated UI testing). import.meta.env.DEV
  // is statically replaced by Vite, so this whole block is dead-code-eliminated
  // from production builds.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    window.__relayDebug = {
      ...window.__relayDebug,
      status,
      sessionId,
      iceServerCount: iceServers?.length ?? 0,
      hasTurn: !!iceServers?.some((s) => JSON.stringify(s.urls).includes('turn')),
    };
    window.__relaySocket = getSocket();
  }

  return (
    <SocketConnectionContext.Provider value={{ status, sessionId, iceServers, reconnect }}>
      {children}
    </SocketConnectionContext.Provider>
  );
}

export function useSocketConnection() {
  const ctx = useContext(SocketConnectionContext);
  if (!ctx) {
    throw new Error('useSocketConnection must be used within a SocketConnectionProvider');
  }
  return ctx;
}
