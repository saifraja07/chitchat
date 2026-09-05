import { AlertIcon } from './icons.jsx';

/**
 * `status` drives copy and visual treatment for the non-connected states
 * a video/chat screen can be in. Rendered with aria-live="polite" so
 * screen reader users hear state changes (found a match, stranger left,
 * connection failed) without needing to focus anything.
 *
 * `body` may be a static string or a function of `detail` (used by
 * media-error, whose message varies by failure kind: permission denied
 * vs. no device vs. device already in use).
 */
const COPY = {
  searching: {
    title: 'Looking for someone to talk to…',
    body: () => 'This usually takes a few seconds.',
  },
  connecting: {
    title: 'Connecting…',
    body: () => 'Setting up your video call.',
  },
  disconnected: {
    title: 'The stranger left',
    body: () => 'Start a new conversation whenever you\u2019re ready.',
  },
  failed: {
    title: 'Call didn\u2019t connect',
    body: () => 'Let\u2019s find you someone new.',
  },
  'media-error': {
    title: 'Camera or microphone unavailable',
    body: (detail) => detail || 'Could not access your camera or microphone.',
  },
  error: {
    title: 'Connection problem',
    body: () => 'We couldn\u2019t reach the server. Check your connection and try again.',
  },
};

const SPINNER_STATUSES = new Set(['searching', 'connecting']);
const ALERT_STATUSES = new Set(['error', 'failed', 'media-error']);

export default function StatusBanner({ status, detail, action }) {
  const copy = COPY[status];
  if (!copy) return null;

  return (
    <div className={`status-banner status-banner--${status}`} role="status" aria-live="polite">
      {SPINNER_STATUSES.has(status) && <span className="status-banner__spinner" aria-hidden="true" />}
      {ALERT_STATUSES.has(status) && <AlertIcon width={22} height={22} />}
      <div className="status-banner__text">
        <p className="status-banner__title">{copy.title}</p>
        <p className="status-banner__body">{copy.body(detail)}</p>
      </div>
      {action}
    </div>
  );
}
