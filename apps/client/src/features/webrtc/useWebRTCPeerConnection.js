import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../socket/socketClient.js';

// Defensive fallback only — in normal operation the server sends
// ice:servers immediately after connecting (see
// SocketConnectionContext), well before any match/peer connection could
// exist. This covers the edge case of a peer connection needing to be
// created before that response has arrived, so WebRTC setup is never
// blocked waiting on it.
// If a connection hasn't reached 'connected' within this window, we
// declare it failed ourselves rather than waiting on the browser's
// native state machine indefinitely. This was added after testing
// against a real TURN server: with iceTransportPolicy 'relay' and every
// candidate source failing (e.g. a rejected/expired TURN credential),
// Chrome's own connectionState can get stuck at 'new' forever — ICE
// candidate gathering itself never completes, so the browser never
// concludes "no usable candidates, this has failed". Left alone, that
// would strand a user on a "Connecting…" screen with no way out, which
// directly defeats "connection failures are handled gracefully."
const CONNECTION_SETUP_TIMEOUT_MS = 20_000;

const FALLBACK_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * Owns exactly one RTCPeerConnection for the CURRENT room. Whenever
 * roomId/role/localStream changes — a new match, media becoming ready,
 * or no active room at all — the previous connection (if any) is fully
 * closed and, if we now have everything needed, a fresh one is set up.
 * This is the ONLY place webrtc:offer / webrtc:answer /
 * webrtc:ice-candidate are listened for.
 *
 * `iceServers` comes from the server (see SocketConnectionContext) —
 * STUN plus a short-lived TURN credential if TURN is configured
 * server-side. The server mints it, never the client, so a TURN
 * deployment's shared secret is never exposed.
 *
 * `connectionState` mirrors RTCPeerConnection.connectionState: 'new' |
 * 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'.
 *
 * StrictMode note (same issue as Phase 4's useMatchmaking): effect
 * cleanup runs on every dependency change, not just real unmounts, and
 * React's dev-only StrictMode proves it by synchronously simulating an
 * unmount+remount once right after mount. Naively closing the
 * RTCPeerConnection and re-running setup in that cleanup would close a
 * freshly-created connection and, worse, send a SECOND offer over the
 * signaling channel — the peer would receive two offers for what the
 * user experienced as one match. The fix is the same pattern as
 * before: defer the actual teardown, and if the very next effect run
 * turns out to be for the exact same (roomId, role, localStream) —
 * which is what a phantom remount looks like — cancel the deferred
 * teardown and resume the existing connection instead of rebuilding it.
 * A genuine change (new room, or no room) lets the old session's
 * deferred teardown proceed untouched while a fresh one is set up.
 */
export function useWebRTCPeerConnection({ roomId, role, localStream, iceServers }) {
  const [remoteStream, setRemoteStream] = useState(null);
  const [connectionState, setConnectionState] = useState('new');
  const pendingTeardownRef = useRef(null); // { timeoutId, roomId, role, localStream, teardown }

  useEffect(() => {
    if (!roomId || !role || !localStream) {
      setRemoteStream(null);
      setConnectionState('new');
      return undefined;
    }

    const pending = pendingTeardownRef.current;
    const isPhantomRemount =
      pending && pending.roomId === roomId && pending.role === role && pending.localStream === localStream;

    if (isPhantomRemount) {
      clearTimeout(pending.timeoutId);
      pendingTeardownRef.current = null;
      return () => scheduleTeardown(roomId, role, localStream, pending.teardown);
    }
    // If there's a pending teardown for a DIFFERENT session, it's
    // already scheduled and will run on its own timer — we don't touch
    // it; we just build a fresh session below for the new one.

    const socket = getSocket();
    let pendingRemoteCandidates = [];
    let cancelled = false;

    const pc = new RTCPeerConnection({ iceServers: iceServers ?? FALLBACK_ICE_SERVERS });

    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    const remote = new MediaStream();
    setRemoteStream(remote);
    setConnectionState('new');

    pc.ontrack = (event) => {
      remote.addTrack(event.track);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc:ice-candidate', { candidate: event.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      if (cancelled) return;
      setConnectionState(pc.connectionState);
      if (pc.connectionState === 'connected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        clearTimeout(setupWatchdog);
      }
    };

    const setupWatchdog = setTimeout(() => {
      if (cancelled) return;
      if (pc.connectionState !== 'connected') {
        setConnectionState('failed');
      }
    }, CONNECTION_SETUP_TIMEOUT_MS);

    async function flushPendingCandidates() {
      const queued = pendingRemoteCandidates;
      pendingRemoteCandidates = [];
      for (const candidate of queued) {
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          // A late/duplicate candidate can legitimately fail to add
          // once the connection has already moved past it — not fatal.
        }
      }
    }

    async function handleOffer({ sdp }) {
      if (cancelled) return;
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await flushPendingCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc:answer', { sdp: pc.localDescription.sdp });
    }

    async function handleAnswer({ sdp }) {
      if (cancelled) return;
      await pc.setRemoteDescription({ type: 'answer', sdp });
      await flushPendingCandidates();
    }

    async function handleIceCandidate({ candidate }) {
      if (cancelled) return;
      if (!pc.remoteDescription) {
        pendingRemoteCandidates.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // see flushPendingCandidates
      }
    }

    socket.on('webrtc:offer', handleOffer);
    socket.on('webrtc:answer', handleAnswer);
    socket.on('webrtc:ice-candidate', handleIceCandidate);

    if (role === 'initiator') {
      (async () => {
        const offer = await pc.createOffer();
        if (cancelled) return;
        await pc.setLocalDescription(offer);
        socket.emit('webrtc:offer', { sdp: pc.localDescription.sdp });
      })();
    }

    const teardown = () => {
      cancelled = true;
      clearTimeout(setupWatchdog);
      socket.off('webrtc:offer', handleOffer);
      socket.off('webrtc:answer', handleAnswer);
      socket.off('webrtc:ice-candidate', handleIceCandidate);
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.getSenders().forEach((sender) => {
        try {
          pc.removeTrack(sender);
        } catch {
          // sender may already be invalid if the connection is closing
        }
      });
      pc.close();
    };

    return () => scheduleTeardown(roomId, role, localStream, teardown);

    function scheduleTeardown(rId, r, ls, teardownFn) {
      const timeoutId = setTimeout(() => {
        pendingTeardownRef.current = null;
        teardownFn();
      }, 0);
      pendingTeardownRef.current = { timeoutId, roomId: rId, role: r, localStream: ls, teardown: teardownFn };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, role, localStream]);
  // iceServers is deliberately NOT a dependency here: it's read fresh
  // (via closure) each time this effect actually runs to build a NEW
  // connection, but changes to iceServers alone must never trigger a
  // rebuild — that would tear down and reconnect a possibly-already-
  // connected call just because, say, a slightly-later credential
  // refresh arrived. In practice iceServers is available well before
  // any match can occur, so this only matters for a rare early-race
  // edge case, but excluding it here is what makes that edge case safe
  // instead of a mid-call glitch.

  return { remoteStream, connectionState };
}
