import { useState } from 'react';
import IconButton from '../../shared/ui/IconButton.jsx';
import { SendIcon } from '../../shared/ui/icons.jsx';

export default function MessageInput({ onSend, disabled = false }) {
  const [value, setValue] = useState('');

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
