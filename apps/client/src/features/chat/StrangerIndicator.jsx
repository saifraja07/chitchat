export default function StrangerIndicator({ connected }) {
  return (
    <div className="stranger-indicator">
      <span
        className={`stranger-indicator__dot${connected ? ' stranger-indicator__dot--connected' : ''}`}
        aria-hidden="true"
      />
      <span>{connected ? 'Stranger connected' : 'Not connected'}</span>
    </div>
  );
}
