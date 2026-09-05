/**
 * Icon-only control. `label` is required and becomes the accessible name
 * via aria-label — icons alone never convey meaning to screen readers.
 *
 * Set `toggle` for on/off controls (mic, camera): `active` then drives
 * aria-pressed so assistive tech announces current state. Leave `toggle`
 * false (default) for one-shot actions like Send, where pressed state
 * doesn't apply.
 */
export default function IconButton({ icon, label, active = true, toggle = false, danger = false, onClick }) {
  return (
    <button
      type="button"
      className={`icon-btn${danger ? ' icon-btn--danger' : ''}${toggle && !active ? ' icon-btn--off' : ''}`}
      aria-label={label}
      aria-pressed={toggle ? !active : undefined}
      onClick={onClick}
      title={label}
    >
      {icon}
    </button>
  );
}
