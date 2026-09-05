export default function ModeCard({ icon, title, description, accent, onSelect }) {
  return (
    <button
      type="button"
      className={`mode-card mode-card--${accent}`}
      onClick={onSelect}
    >
      <span className="mode-card__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="mode-card__title">{title}</span>
      <span className="mode-card__description">{description}</span>
    </button>
  );
}
