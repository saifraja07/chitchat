export default function ModeHeader({ modeLabel, accent }) {
  return (
    <header className="mode-header">
      <span className="mode-header__logo">
        <span className="home-logo__mark" aria-hidden="true" />
        Relay
      </span>
      <span className={`mode-header__badge mode-header__badge--${accent}`}>{modeLabel}</span>
    </header>
  );
}
