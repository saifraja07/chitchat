import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../socket/socketClient.js';

// If a connection hasn't reached 'connected' within this window, we
// declare it failed ourselves rather than waiting on the browser's
// native state machine indefinitely. This was added after testing
// against a real TURN server: with iceTransportPolicy 'relay' and every
// candidate source failing (e.g. a rejected/expired TURN credential),
// Chrome's own connectionState can get stuck at 'new' forever — ICE
// candidate gathering itself never completes, so the browser never
// concludes "no usable candidates, this has failed". Left alone, that
// would strand a user on a "Connecting..." screen with no way out, which
// directly defeats "connection failures are handled gracefully."
const CONNECTION_SETUP_TIMEOUT_MS = 20_000;

// Defensive fallback only — in normal operation the server sends
// ice:servers immediately after connecting (see
// SocketConnectionContext), well before any match/peer connection could
// exist.
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
 * RTCPeerConnection in that cleanup would close a freshly-created
 * connection and, worse, send a SECOND offer over the signaling channel
 * for what the user experienced as one match.
 *
 * The fix has two parts, done at different times:
 *  1. IMMEDIATELY on any cleanup: mark this session cancelled and
 *     detach its socket listeners. This has to happen synchronously,
 *     not deferred — a genuinely new room's setup runs synchronously
 *     right after, in the same effect-flush, and until the old
 *     listeners are gone, an incoming signaling event would be
 *     delivered to BOTH the old (dying) handlers and the new ones.
 *  2. DEFERRED (one macrotask later): actually call pc.close(). If the
 *     very next effect run turns out to be for the exact same (roomId,
 *     role, localStream) — what a StrictMode phantom remount looks
 *     like — the deferred close is cancelled and the same
 *     RTCPeerConnection is reused (its listeners re-attached) instead
 *     of being rebuilt and sending a duplicate offer. A genuine change
 *     lets the deferred close proceed untouched.
 *
 * This depends on `localStream`'s reference staying stable across a
 * StrictMode phantom cycle — see useLocalMedia.js's own comment on why
 * it takes the same care, discovered by tracing an intermittent failure
 * to exactly this: a changing localStream reference was defeating the
 * phantom-remount detection here and interrupting real negotiations.
 */
export function useWebRTCPeerConnection({ roomId, role, localStream, iceServers }) {
  const [remoteStream, setRemoteStream] = useState(null);
  const [connectionState, setConnectionState] = useState('new');
  const pendingCloseRef = useRef(null); // { timeoutId, roomId, role, localStream, session, attach, detach, close }

  useEffect(() => {
    if (!roomId || !role || !localStream) {
      setRemoteStream(null);
      setConnectionState('new');
      return undefined;
    }

    const socket = getSocket();
    const pending = pendingCloseRef.current;
    const isPhantomRemount =
      pending && pending.roomId === roomId && pending.role === role && pending.localStream === localStream;

    if (isPhantomRemount) {
      clearTimeout(pending.timeoutId);
      pendingCloseRef.current = null;
      pending.session.cancelled = false;
      pending.attach();
      return () =>
        detachAndScheduleClose(roomId, role, localStream, pending.session, pending.attach, pending.detach, pending.close);
    }
    // If there's a pending close for a DIFFERENT session, its listeners
    // were already detached immediately when that cleanup ran — we
    // don't need to touch it further; its own deferred close will run
    // on its own timer while we build a fresh session below.

    const session = { cancelled: false, pendingRemoteCandidates: [] };
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

    let setupWatchdog = null;
    pc.onconnectionstatechange = () => {
      if (session.cancelled) return;
      setConnectionState(pc.connectionState);
      if (pc.connectionState === 'connected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        clearTimeout(setupWatchdog);
      }
    };

    setupWatchdog = setTimeout(() => {
      if (session.cancelled) return;
      if (pc.connectionState !== 'connected') {
        setConnectionState('failed');
      }
    }, CONNECTION_SETUP_TIMEOUT_MS);

    async function flushPendingCandidates() {
      const queued = session.pendingRemoteCandidates;
      session.pendingRemoteCandidates = [];
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
      if (session.cancelled) return;
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await flushPendingCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc:answer', { sdp: pc.localDescription.sdp });
    }

    async function handleAnswer({ sdp }) {
      if (session.cancelled) return;
      await pc.setRemoteDescription({ type: 'answer', sdp });
      await flushPendingCandidates();
    }

    async function handleIceCandidate({ candidate }) {
      if (session.cancelled) return;
      if (!pc.remoteDescription) {
        session.pendingRemoteCandidates.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // see flushPendingCandidates
      }
    }

    function attach() {
      socket.on('webrtc:offer', handleOffer);
      socket.on('webrtc:answer', handleAnswer);
      socket.on('webrtc:ice-candidate', handleIceCandidate);
    }

    function detach() {
      socket.off('webrtc:offer', handleOffer);
      socket.off('webrtc:answer', handleAnswer);
      socket.off('webrtc:ice-candidate', handleIceCandidate);
    }

    attach();

    if (role === 'initiator') {
      (async () => {
        const offer = await pc.createOffer();
        if (session.cancelled) return;
        await pc.setLocalDescription(offer);
        socket.emit('webrtc:offer', { sdp: pc.localDescription.sdp });
      })();
    }

    function close() {
      clearTimeout(setupWatchdog);
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
    }

    return () => detachAndScheduleClose(roomId, role, localStream, session, attach, detach, close);

    function detachAndScheduleClose(rId, r, ls, sess, attachFn, detachFn, closeFn) {
      // Immediate, not deferred: a genuinely new room's setup runs
      // synchronously right after this, in the same effect-flush, and
      // must never have its signaling events double-delivered to a
      // stale, about-to-close connection's handlers too.
      sess.cancelled = true;
      detachFn();

      const timeoutId = setTimeout(() => {
        // Guard, not just `= null`: if a newer pending-close was already
        // scheduled for a different session by the time this fires
        // (only reachable via unusual rapid-fire remount chains beyond
        // what a single StrictMode phantom cycle produces), this stale
        // timer must not wipe out that newer reference.
        if (pendingCloseRef.current?.close === closeFn) {
          pendingCloseRef.current = null;
        }
        closeFn();
      }, 0);
      pendingCloseRef.current = {
        timeoutId,
        roomId: rId,
        role: r,
        localStream: ls,
        session: sess,
        attach: attachFn,
        detach: detachFn,
        close: closeFn,
      };
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
