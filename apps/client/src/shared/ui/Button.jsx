export default function Button({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
  type = 'button',
  ...rest
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`btn btn--${variant}`}
      {...rest}
    >
      {children}
    </button>
  );
}
