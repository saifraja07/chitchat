import ModeHeader from '../shared/ui/ModeHeader.jsx';
import StrangerIndicator from '../features/chat/StrangerIndicator.jsx';
import ChatConversation from '../features/chat/ChatConversation.jsx';
import Button from '../shared/ui/Button.jsx';
import { useSocketConnection } from '../features/socket/SocketConnectionContext.jsx';
import { useMatchmaking } from '../features/matchmaking/useMatchmaking.js';
import { useMatchmakingDebug } from '../features/matchmaking/useMatchmakingDebug.js';

/**
 * Chat messages (Phase 5) are owned by <ChatConversation>, not here —
 * see that component's comment for why keeping message state out of
 * this page matters for render performance (a new message shouldn't
 * re-render the header, stranger indicator, or Next/Leave row).
 */
export default function ChatModePage({ onLeave }) {
  const { status: socketStatus, reconnect } = useSocketConnection();
  const { status: matchStatus, room, next, retry } = useMatchmaking('chat');
  useMatchmakingDebug(matchStatus, room);

  const socketReady = socketStatus === 'connected';
  const status = socketReady ? matchStatus : 'error';
  const connected = status === 'connected';

  const handleRetry = () => {
    if (!socketReady) {
      reconnect();
    } else {
      retry();
    }
  };

  return (
    <div className="page page--mode">
      <ModeHeader modeLabel="Chat" accent="chat" />

      <main className="mode-layout mode-layout--chat">
        <StrangerIndicator connected={connected} />

        <ChatConversation roomId={room?.roomId} status={status} onRetry={handleRetry} onFindNew={next} />

        <div className="mode-layout__actions">
          <Button variant="secondary" onClick={next} disabled={!connected}>
            Next
          </Button>
          <Button variant="danger" onClick={onLeave}>
            Leave
          </Button>
        </div>
      </main>
    </div>
  );
}
