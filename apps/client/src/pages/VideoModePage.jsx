import ModeHeader from '../shared/ui/ModeHeader.jsx';
import VideoStage from '../features/video/VideoStage.jsx';
import VideoControls from '../features/video/VideoControls.jsx';
import ChatPanel from '../features/chat/ChatPanel.jsx';
import StatusBanner from '../shared/ui/StatusBanner.jsx';
import Button from '../shared/ui/Button.jsx';
import { useSocketConnection } from '../features/socket/SocketConnectionContext.jsx';
import { useMatchmaking } from '../features/matchmaking/useMatchmaking.js';
import { useMatchmakingDebug } from '../features/matchmaking/useMatchmakingDebug.js';
import { useLocalMedia } from '../features/webrtc/useLocalMedia.js';
import { useWebRTCPeerConnection } from '../features/webrtc/useWebRTCPeerConnection.js';
import { useWebrtcDebug } from '../features/webrtc/useWebrtcDebug.js';

/**
 * Three independent status sources, combined into one displayed banner
 * state, in priority order:
 *  1. socketStatus (Phase 3) — is the transport up at all
 *  2. mediaError (Phase 6) — could we get camera/mic access
 *  3. matchStatus (Phase 4) — are we matched with anyone
 *  4. rtcConnectionState (Phase 6) — is the actual P2P call up
 *
 * Camera/mic permission is requested by useLocalMedia, which is only
 * ever imported here — Chat mode and the home page never call it, so
 * they never trigger a permission prompt.
 */
export default function VideoModePage({ onLeave }) {
  const { status: socketStatus, iceServers, reconnect } = useSocketConnection();
  const { status: matchStatus, room, next, retry: retryMatch } = useMatchmaking('video');
  useMatchmakingDebug(matchStatus, room);

  const {
    stream: localStream,
    micOn,
    cameraOn,
    toggleMic,
    toggleCamera,
    error: mediaError,
    retry: retryMedia,
  } = useLocalMedia();

  const { remoteStream, connectionState: rtcConnectionState } = useWebRTCPeerConnection({
    roomId: room?.roomId ?? null,
    role: room?.role ?? null,
    localStream,
    iceServers,
  });

  useWebrtcDebug({
    localStream,
    remoteStream,
    connectionState: rtcConnectionState,
    mediaError,
    micOn,
    cameraOn,
  });

  const socketReady = socketStatus === 'connected';

  let status;
  if (!socketReady) {
    status = 'error';
  } else if (mediaError) {
    status = 'media-error';
  } else if (matchStatus !== 'connected') {
    status = matchStatus; // 'searching' | 'disconnected' | 'error'
  } else if (rtcConnectionState === 'failed') {
    status = 'failed';
  } else if (rtcConnectionState !== 'connected') {
    status = 'connecting'; // covers 'new', 'connecting', and transient 'disconnected'
  } else {
    status = 'connected';
  }

  const handleRetry = () => {
    if (!socketReady) {
      reconnect();
    } else if (status === 'media-error') {
      retryMedia();
    } else {
      retryMatch();
    }
  };

  return (
    <div className="page page--mode">
      <ModeHeader modeLabel="Video" accent="video" />

      <main className="mode-layout mode-layout--video">
        <section className="mode-layout__stage" aria-label="Video call">
          <div className="video-wrapper">
            <VideoStage
              localStream={localStream}
              remoteStream={remoteStream}
              cameraOn={cameraOn}
              showRemotePlaceholder={status !== 'connected'}
            />

            {status !== 'connected' && (
              <div className="mode-layout__overlay">
                <StatusBanner
                  status={status}
                  detail={mediaError?.message}
                  action={
                    status === 'error' || status === 'media-error' ? (
                      <Button variant="secondary" onClick={handleRetry}>
                        Try again
                      </Button>
                    ) : status === 'disconnected' || status === 'failed' ? (
                      <Button variant="primary" onClick={next}>
                        Find someone new
                      </Button>
                    ) : null
                  }
                />
              </div>
            )}
          </div>

          <VideoControls
            micOn={micOn}
            cameraOn={cameraOn}
            onToggleMic={toggleMic}
            onToggleCamera={toggleCamera}
            onNext={next}
            onLeave={onLeave}
            disabled={status !== 'connected'}
          />
        </section>

        <aside className="mode-layout__chat" aria-label="Text chat">
          <ChatPanel roomId={room?.roomId} connected={matchStatus === 'connected'} />
        </aside>
      </main>
    </div>
  );
}
