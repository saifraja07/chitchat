import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../socket/socketClient.js';
import { useSocketConnection } from '../socket/SocketConnectionContext.jsx';

/**
 * Drives real matchmaking state for a mode screen (video or chat).
 * This is the ONLY place match:found / match:ended / queue:joined /
 * queue:error listeners are attached — VideoModePage and ChatModePage
 * both consume it instead of touching the socket directly, so listeners
 * never get scattered or duplicated across components.
 *
 * `status`:
 *  - 'searching'    waiting in the server-side queue
 *  - 'connected'    matched with a peer, room active
 *  - 'disconnected' peer left or disconnected; can start a new search
 *  - 'error'        the server rejected the request (rare/defensive)
 *
 * On telling the server "I'm leaving": effect cleanups run on EVERY
 * dependency change, not just real unmounts — React's dev-mode
 * StrictMode makes this concrete by intentionally simulating an
 * unmount+remount once right after the initial mount, specifically to
 * catch effects that assume otherwise. Naively emitting match:leave
 * from cleanup tears down a just-found match the instant after
 * StrictMode's synthetic cleanup runs, since by the time a mode page
 * mounts the socket has typically been connected for a while already
 * (SocketConnectionProvider connects at app start), so a "still
 * connected" guard doesn't distinguish the two cases.
 *
 * The fix: defer the actual match:leave emission via a macrotask. A
 * genuine unmount has no follow-up, so it fires a moment later as
 * intended. A StrictMode-style remount happens synchronously in the
 * same tick, so the next effect run cancels the pending leave before
 * it ever reaches the server — and, since nothing was actually left,
 * skips re-emitting queue:join too (which would otherwise get rejected
 * as "already active").
 */
export function useMatchmaking(mode) {
  const { status: socketStatus, sessionId } = useSocketConnection();
  const [status, setStatus] = useState('searching');
  const [room, setRoom] = useState(null); // { roomId, role }
  const pendingLeaveRef = useRef(null);

  useEffect(() => {
    if (socketStatus !== 'connected' || !sessionId) return;

    const socket = getSocket();

    const recoveringFromPhantomCleanup = pendingLeaveRef.current !== null;
    if (recoveringFromPhantomCleanup) {
      clearTimeout(pendingLeaveRef.current);
      pendingLeaveRef.current = null;
    } else {
      setStatus('searching');
      setRoom(null);
    }

    const handleFound = ({ roomId, role }) => {
      setRoom({ roomId, role });
      setStatus('connected');
    };
    const handleEnded = () => {
      setRoom(null);
      setStatus('disconnected');
    };
    const handleJoined = () => {
      setRoom(null);
      setStatus('searching');
    };
    const handleError = () => {
      setRoom(null);
      setStatus('error');
    };

    socket.on('match:found', handleFound);
    socket.on('match:ended', handleEnded);
    socket.on('queue:joined', handleJoined);
    socket.on('queue:error', handleError);

    // Skip re-joining if we just cancelled a phantom leave — the server
    // never heard about it, so we're already validly queued/matched.
    if (!recoveringFromPhantomCleanup) {
      socket.emit('queue:join', { mode });
    }

    return () => {
      socket.off('match:found', handleFound);
      socket.off('match:ended', handleEnded);
      socket.off('queue:joined', handleJoined);
      socket.off('queue:error', handleError);

      if (socket.connected) {
        pendingLeaveRef.current = setTimeout(() => {
          pendingLeaveRef.current = null;
          socket.emit('match:leave', {});
        }, 0);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sessionId, socketStatus === 'connected']);

  const next = () => {
    setStatus('searching');
    setRoom(null);
    getSocket().emit('match:next', {});
  };

  const retry = () => {
    setStatus('searching');
    setRoom(null);
    getSocket().emit('queue:join', { mode });
  };

  return { status, room, next, retry };
}
