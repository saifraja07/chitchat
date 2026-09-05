import { useChatMessages } from './useChatMessages.js';
import MessageList from './MessageList.jsx';
import MessageInput from './MessageInput.jsx';

/**
 * Encapsulates the video screen's side chat: message list + input, both
 * driven by useChatMessages keyed on the current roomId. Rendering
 * VideoModePage does NOT re-render this component's parent tree when a
 * message arrives — the state lives here, so only this subtree updates.
 */
export default function ChatPanel({ roomId, connected }) {
  const { messages, send } = useChatMessages(roomId);

  return (
    <>
      <MessageList
        messages={messages}
        emptyMessage={connected ? "Say hi — you're connected." : 'Chat opens once you\u2019re connected.'}
      />
      <MessageInput onSend={send} disabled={!connected} />
    </>
  );
}
