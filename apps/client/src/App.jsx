import { useState } from 'react';
import HomePage from './pages/HomePage.jsx';
import VideoModePage from './pages/VideoModePage.jsx';
import ChatModePage from './pages/ChatModePage.jsx';
import { SocketConnectionProvider } from './features/socket/SocketConnectionContext.jsx';

/**
 * Three screens, no deep-linking requirement yet, so plain state covers
 * navigation without pulling in a router. If URL-addressable modes
 * become a requirement, this is the one place a router would replace
 * this switch.
 *
 * SocketConnectionProvider connects once for the lifetime of the app
 * and is the single source of connection state for every screen below.
 */
export default function App() {
  const [view, setView] = useState('home');

  return (
    <SocketConnectionProvider>
      {view === 'video' && <VideoModePage onLeave={() => setView('home')} />}
      {view === 'chat' && <ChatModePage onLeave={() => setView('home')} />}
      {view === 'home' && <HomePage onSelectMode={setView} />}
    </SocketConnectionProvider>
  );
}
