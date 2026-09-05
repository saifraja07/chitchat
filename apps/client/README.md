# Relay — frontend

React + Vite single-page app for Relay: mode selection, video/chat
screens, matchmaking UI, WebRTC handling, and chat.

## Running locally

```bash
cp .env.example .env      # edit if your backend isn't on localhost:4000
npm install
npm run dev                 # http://localhost:5173
npm run build                # production build to dist/
```

Requires the backend (`apps/server`) running and reachable at
`VITE_SOCKET_URL`.

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `VITE_SOCKET_URL` | `http://localhost:4000` | Backend Socket.IO URL |
| `VITE_APP_ENV` | `development` | Informational only |

There is no client-side ICE server config. STUN, and a short-lived TURN
credential if TURN is configured on the backend, are sent by the server
over Socket.IO right after connecting — never baked into the build. See
the server README's "WebRTC connectivity" section for the full scheme.

Vite only exposes variables prefixed `VITE_` to client code, and only
through `import.meta.env` — all of them are read in exactly one place,
`src/shared/config/env.js`.

## Architecture at a glance

- **Routing**: no router — three screens (`Home`, `VideoModePage`,
  `ChatModePage`) switched via plain state in `App.jsx`. Revisit this if
  URL-addressable modes become a requirement.
- **Socket connection**: a single Socket.IO client instance
  (`features/socket/socketClient.js`), connected once for the app's
  lifetime via `SocketConnectionProvider` — the only place connection
  lifecycle listeners are attached.
- **Matchmaking**: `useMatchmaking` hook, one instance per mode page.
  Uses a deferred-teardown pattern to stay correct under React's
  StrictMode double-invoke (and, more importantly, under any real
  remount) — see the hook's comments for why a naive effect cleanup
  would send a duplicate "leave" to the server.
- **Chat**: message state is deliberately colocated in small leaf
  components (`ChatPanel`, `ChatConversation`) rather than the page
  component, so a new message only re-renders that subtree — verified
  with an actual render-count check during development, not assumed.
- **WebRTC**: `useLocalMedia` (camera/mic, requested only when a Video
  mode page actually mounts) + `useWebRTCPeerConnection` (one
  `RTCPeerConnection` per room, torn down and rebuilt on every match
  change; ICE servers — STUN plus TURN if configured — come from the
  server, never a build-time config, so a TURN deployment's credentials
  are never static values shipped in the bundle). A 20-second
  connection-setup watchdog independently declares a call failed if it
  hasn't connected by then — added after real testing showed the
  browser's native `connectionState` can get stuck at `'new'`
  indefinitely in some all-candidates-rejected failure modes. Uses the
  same deferred-teardown pattern as matchmaking to avoid sending a
  duplicate SDP offer under a phantom remount.

## Known limitations

See the server README's "Known limitations" section — most of the
honest caveats (TURN tested only on loopback, no moderation,
load-testing scope) apply to the app as a whole, not one side of it
specifically. Frontend-specific notes:

- No URL-based routing/deep-linking to a specific mode.
- No visual regression testing — layout correctness has been verified
  manually and via Playwright screenshots during development, not via
  an automated visual-diff pipeline.
