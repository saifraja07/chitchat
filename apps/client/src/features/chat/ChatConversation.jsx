import { useChatMessages } from './useChatMessages.js';
import MessageList from './MessageList.jsx';
import MessageInput from './MessageInput.jsx';
import StatusBanner from '../../shared/ui/StatusBanner.jsx';
import Button from '../../shared/ui/Button.jsx';

/**
 * Encapsulates chat mode's conversation area + input, both driven by
 * useChatMessages keyed on the current roomId. Kept as its own
 * component (rather than living directly in ChatModePage) so a new
 * message only re-renders this subtree — not the header, stranger
 * indicator, or Next/Leave actions row next to it.
 */
export default function ChatConversation({ roomId, status, onRetry, onFindNew }) {
  const { messages, send } = useChatMessages(roomId);
  const connected = status === 'connected';

  return (
    <>
      <div className="mode-layout__conversation">
        {connected ? (
          <MessageList messages={messages} />
        ) : (
          <StatusBanner
            status={status}
            action={
              status === 'error' ? (
                <Button variant="secondary" onClick={onRetry}>
                  Try again
                </Button>
              ) : status === 'disconnected' ? (
                <Button variant="primary" onClick={onFindNew}>
                  Find someone new
                </Button>
              ) : null
            }
          />
        )}
      </div>
      <MessageInput onSend={send} disabled={!connected} />
    </>
  );
}
