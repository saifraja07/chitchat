import { useEffect, useRef, useState } from 'react';
import IconButton from '../../shared/ui/IconButton.jsx';
import { SendIcon } from '../../shared/ui/icons.jsx';

export default function MessageInput({ onSend, disabled = false }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  // Focus the field the moment chat becomes usable (a fresh match, or a
  // reconnect) so the person can start typing right away instead of
  // having to click into it first. Only fires on the disabled -> enabled
  // transition, never steals focus while the user is doing something
  // else on an already-enabled input.
  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [disabled]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
  };

  return (
    <form className="message-input" onSubmit={handleSubmit}>
      <label htmlFor="message-input-field" className="visually-hidden">
        Message
      </label>
      <input
        ref={inputRef}
        id="message-input-field"
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Type a message"
        maxLength={500}
        disabled={disabled}
        autoComplete="off"
      />
      <IconButton
        icon={<SendIcon />}
        label="Send message"
        onClick={handleSubmit}
      />
    </form>
  );
}
