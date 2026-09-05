/**
 * Displays a list of messages. `messages` is expected to be
 * `{ id, from: 'me' | 'stranger', text }[]`. Real-time transport is
 * wired in a later phase — this component only needs data shaped this
 * way, so it doesn't change when that happens.
 */
export default function MessageList({ messages, emptyMessage = "Say hi — you're connected." }) {
  return (
    <div className="message-list" role="log" aria-live="polite" aria-label="Conversation">
      {messages.length === 0 && (
        <p className="message-list__empty">{emptyMessage}</p>
      )}
      {messages.map((message) => (
        <div key={message.id} className={`message message--${message.from}`}>
          {message.text}
        </div>
      ))}
    </div>
  );
}
