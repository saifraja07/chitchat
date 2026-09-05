import { useEffect, useState } from 'react';
import { getSocket } from '../socket/socketClient.js';

/**
 * Owns the message list for the CURRENT room only. Messages are never
 * persisted and are wiped the moment the room changes — a new match, or
 * no match at all — matching "messages exist only for the active
 * session."
 *
 * This is the ONLY place 'chat:message' is listened for. It's meant to
 * be called from a small leaf component (ChatPanel / ChatConversation),
 * not from the page component itself — React only re-renders the
 * component whose state changed and its children, so keeping this
 * state out of the page means a new message re-renders just that leaf,
 * not the whole mode screen (video stage, controls, header, etc).
 */
export function useChatMessages(roomId) {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    setMessages([]);
    if (!roomId) return;

    const socket = getSocket();
    const handleIncoming = ({ text }) => {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), from: 'stranger', text }]);
    };

    socket.on('chat:message', handleIncoming);
    return () => socket.off('chat:message', handleIncoming);
  }, [roomId]);

  const send = (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Optimistic local echo — no need to wait on a round trip to show
    // the sender their own message. The server independently validates
    // and normalizes its own copy before relaying to the peer; on the
    // rare rejection (rate limit, empty-after-normalization) the sender
    // just doesn't get a chat:error surfaced here, matching "keep the
    // feature minimal" — normal use never hits that path since the
    // input already enforces length and non-empty client-side.
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), from: 'me', text: trimmed }]);
    getSocket().emit('chat:message', { text: trimmed });
  };

  return { messages, send };
}
