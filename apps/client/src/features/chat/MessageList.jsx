import { useEffect, useRef } from 'react';

/**
 * Displays a list of messages. `messages` is expected to be
 * `{ id, from: 'me' | 'stranger', text }[]`.
 *
 * Auto-scrolls to the newest message whenever the list changes, so the
 * latest message is always in view as the conversation grows — the
 * container itself scrolls internally (see .message-list's overflow-y),
 * the page never does.
 */
export default function MessageList({ messages, emptyMessage = "Say hi — you're connected." }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

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
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
}
