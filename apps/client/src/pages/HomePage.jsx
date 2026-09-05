import ModeCard from '../features/home/ModeCard.jsx';
import { VideoIcon, ChatIcon } from '../shared/ui/icons.jsx';
import { useSocketConnection } from '../features/socket/SocketConnectionContext.jsx';

/**
 * Mode selection. The whole app pivots on this one choice, so the page
 * stays deliberately narrow in scope: name, one line of framing, two
 * clear paths forward.
 */
export default function HomePage({ onSelectMode }) {
  const { status } = useSocketConnection();
  const offline = status !== 'connected';

  return (
    <div className="page page--home">
      <header className="home-header">
        <span className="home-logo">
          <span
            className={`home-logo__mark${offline ? ' home-logo__mark--offline' : ''}`}
            aria-hidden="true"
          />
          Relay
          {offline && <span className="home-logo__status">Reconnecting…</span>}
        </span>
      </header>

      <main className="home-hero">
        <h1 className="home-hero__title">Talk to someone new.</h1>
        <p className="home-hero__subtitle">
          No accounts, no profiles — just a conversation with a stranger.
        </p>

        <div className="mode-grid">
          <ModeCard
            icon={<VideoIcon width={28} height={28} />}
            title="Video"
            description="Video, audio, and chat"
            accent="video"
            onSelect={() => onSelectMode('video')}
          />
          <ModeCard
            icon={<ChatIcon width={28} height={28} />}
            title="Chat"
            description="Text chat only"
            accent="chat"
            onSelect={() => onSelectMode('chat')}
          />
        </div>
      </main>
    </div>
  );
}
