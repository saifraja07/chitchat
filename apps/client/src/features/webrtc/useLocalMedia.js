import { useEffect, useRef, useState } from 'react';

/**
 * Requests camera+microphone access once, when this hook mounts — which
 * only happens because the caller (VideoModePage) mounted, i.e. the
 * user is actually in Video mode. Chat mode and the home page never
 * import this hook, so they never trigger a permission prompt.
 *
 * The MediaStream lives for the page's whole lifetime, independent of
 * matchmaking/room state — toggling mic/camera disables tracks in
 * place (`track.enabled = false`) rather than stopping them, and
 * moving to a new match (Next) reuses the same stream rather than
 * re-prompting for permission or flickering the camera light off/on.
 * Tracks are only fully stopped when this hook itself unmounts, i.e.
 * the user actually leaves Video mode.
 *
 * `error` distinguishes the getUserMedia failure modes that matter for
 * user-facing messaging: permission denied vs. no device found vs. a
 * device already in use / hardware error vs. anything else.
 *
 * StrictMode note: without care, this hook is doubly vulnerable to
 * React's dev-only mount->cleanup->remount simulation. First, a naive
 * synchronous "mountedRef.current = false" in cleanup lets a SECOND
 * getUserMedia() call fire on remount, producing a genuinely different
 * MediaStream object — which then changes `stream`'s identity mid-flow,
 * which (discovered while testing this) cascades into
 * useWebRTCPeerConnection re-running its own setup effect just because
 * the localStream reference changed, interrupting an in-progress
 * negotiation and causing the connection to silently never complete.
 * Second, even isolated from that, calling acquireMedia() twice
 * requests camera/mic access twice for no reason. Both are avoided the
 * same way as the matchmaking/WebRTC hooks: defer the actual "mark
 * unmounted" transition, and if the very next effect run turns out to
 * be a phantom remount (nothing really changed), cancel the deferred
 * unmount and skip re-acquiring — the original request (in flight or
 * already resolved) is still valid and its stream reference never
 * changes because of this.
 */
export function useLocalMedia() {
  const [stream, setStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [error, setError] = useState(null); // { kind: 'denied' | 'not-found' | 'unreadable' | 'unknown', message }
  const streamRef = useRef(null);
  const mountedRef = useRef(true);
  const pendingUnmountRef = useRef(null);

  async function acquireMedia() {
    setError(null);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (!mountedRef.current) {
        // Unmounted (for real) while this request was in flight. The
        // deferred cleanup below already ran and stopped whatever
        // stream existed at that time — it will NOT run again for this
        // late-arriving stream, so if we don't stop it here ourselves,
        // its tracks (and the camera/mic they hold open) would leak for
        // the rest of the browser tab's lifetime.
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (streamRef.current && streamRef.current !== mediaStream) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      streamRef.current = mediaStream;
      setStream(mediaStream);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(classifyMediaError(err));
    }
  }

  useEffect(() => {
    if (pendingUnmountRef.current) {
      // Phantom remount: the deferred unmount from a moment ago hasn't
      // fired yet, so nothing was actually torn down — cancel it and
      // resume as-is. Do NOT call acquireMedia() again: the original
      // request (in flight or already resolved into `stream`) is still
      // completely valid, and re-requesting here is exactly what would
      // change `stream`'s identity for no real reason.
      clearTimeout(pendingUnmountRef.current);
      pendingUnmountRef.current = null;
      mountedRef.current = true;
      return scheduleUnmount;
    }

    mountedRef.current = true;
    acquireMedia();

    return scheduleUnmount;

    function scheduleUnmount() {
      pendingUnmountRef.current = setTimeout(() => {
        pendingUnmountRef.current = null;
        mountedRef.current = false;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setStream(null);
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMic = () => {
    const next = !micOn;
    setMicOn(next);
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
  };

  const toggleCamera = () => {
    const next = !cameraOn;
    setCameraOn(next);
    streamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
  };

  const retry = () => {
    setStream(null);
    acquireMedia();
  };

  return { stream, micOn, cameraOn, toggleMic, toggleCamera, error, retry };
}

function classifyMediaError(err) {
  const name = err?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return { kind: 'denied', message: 'Camera and microphone access was denied.' };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return { kind: 'not-found', message: 'No camera or microphone was found on this device.' };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return { kind: 'unreadable', message: 'Your camera or microphone is already in use by another app.' };
  }
  if (name === 'NotSupportedError') {
    return { kind: 'unsupported', message: 'Your browser or connection doesn\u2019t support video calls here.' };
  }
  return { kind: 'unknown', message: 'Could not access your camera or microphone.' };
}
