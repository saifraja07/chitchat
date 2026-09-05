import { useEffect } from 'react';

/**
 * Dev-only: mirrors WebRTC + media state onto window.__relayDebug so
 * automated UI tests can read it without adding test-only DOM markup.
 * Dead-code-eliminated from production builds via import.meta.env.DEV.
 */
export function useWebrtcDebug({ localStream, remoteStream, connectionState, mediaError, micOn, cameraOn }) {
  useEffect(() => {
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      window.__relayDebug = {
        ...window.__relayDebug,
        rtcConnectionState: connectionState,
        localTrackCount: localStream ? localStream.getTracks().length : 0,
        localAudioEnabled: localStream ? localStream.getAudioTracks().every((t) => t.enabled) : null,
        localVideoEnabled: localStream ? localStream.getVideoTracks().every((t) => t.enabled) : null,
        remoteTrackCount: remoteStream ? remoteStream.getTracks().length : 0,
        mediaError: mediaError ? mediaError.kind : null,
        micOn,
        cameraOn,
      };
    }
  }, [localStream, remoteStream, connectionState, mediaError, micOn, cameraOn]);
}
