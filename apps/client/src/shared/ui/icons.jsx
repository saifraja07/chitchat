/**
 * Small, dependency-free icon set. Each icon is purely decorative by
 * default (aria-hidden) — the accessible label lives on the interactive
 * element that wraps it (e.g. IconButton's aria-label).
 */

const common = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export function VideoIcon(props) {
  return (
    <svg {...common} {...props}>
      <rect x="2.5" y="6" width="14" height="12" rx="2.5" />
      <path d="M16.5 10.5 21 7.5v9l-4.5-3" />
    </svg>
  );
}

export function ChatIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M4 5.5h16a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H9l-4.5 3.5V17H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

export function MicIcon(props) {
  return (
    <svg {...common} {...props}>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5v4" />
    </svg>
  );
}

export function MicOffIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M9 5.5a3 3 0 0 1 6 0v5.5a3 3 0 0 1-.3 1.3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 9.5 5.8" />
      <path d="M18.5 11a6.5 6.5 0 0 1-1 3.4" />
      <path d="M12 17.5v4" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function CameraIcon(props) {
  return (
    <svg {...common} {...props}>
      <rect x="2.5" y="6" width="14" height="12" rx="2.5" />
      <path d="M16.5 10.5 21 7.5v9l-4.5-3" />
    </svg>
  );
}

export function CameraOffIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M2.5 6h9.5a2.5 2.5 0 0 1 2.5 2.5v3" />
      <path d="M16.5 10.5 21 7.5v9l-4.5-3" />
      <path d="M14.5 18H5a2.5 2.5 0 0 1-2.5-2.5V9" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function SendIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M4 12 20 4l-6.5 16-3-6.5L4 12Z" />
    </svg>
  );
}

export function AlertIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M12 4 21.5 20h-19L12 4Z" />
      <path d="M12 10.5v4" />
      <path d="M12 17.5h.01" />
    </svg>
  );
}
