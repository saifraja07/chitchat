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
 */
export function useLocalMedia() {
  const [stream, setStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [error, setError] = useState(null); // { kind: 'denied' | 'not-found' | 'unreadable' | 'unknown', message }
  const streamRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function acquire() {
      setError(null);
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = mediaStream;
        setStream(mediaStream);
      } catch (err) {
        if (cancelled) return;
        setError(classifyMediaError(err));
      }
    }

    acquire();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
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
    setError(null);
    setStream(null);
    // Re-running acquire() requires a fresh effect pass; simplest is to
    // let the caller remount this hook's owner, but for an in-place
    // retry (no page reload) we just re-invoke the same logic here.
    (async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        streamRef.current = mediaStream;
        setStream(mediaStream);
      } catch (err) {
        setError(classifyMediaError(err));
      }
    })();
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
