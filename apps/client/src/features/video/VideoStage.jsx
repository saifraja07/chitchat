import { useEffect, useRef } from 'react';
import { VideoIcon } from '../../shared/ui/icons.jsx';

/**
 * Attaches the given MediaStreams to their <video> elements via refs
 * (rather than a `src` attribute, which doesn't work for MediaStream
 * objects). Local video is always muted to avoid echoing the user's own
 * mic back at them; remote video carries real audio.
 */
export default function VideoStage({ localStream, remoteStream, cameraOn, showRemotePlaceholder }) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream ?? null;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream ?? null;
    }
  }, [remoteStream]);

  return (
    <div className="video-stage">
      <div className="video-stage__remote">
        <video
          ref={remoteVideoRef}
          className="video-stage__video"
          playsInline
          autoPlay
          aria-label="Stranger's video"
        />
        {showRemotePlaceholder && (
          <div className="video-stage__placeholder" aria-hidden="true">
            <VideoIcon width={32} height={32} />
          </div>
        )}
      </div>

      <div className="video-stage__local">
        <video
          ref={localVideoRef}
          className="video-stage__video"
          playsInline
          autoPlay
          muted
          aria-label="Your video"
        />
        {!cameraOn && (
          <div className="video-stage__local-off" aria-hidden="true">
            Camera off
          </div>
        )}
      </div>
    </div>
  );
}
