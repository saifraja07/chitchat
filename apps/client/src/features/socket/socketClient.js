import { io } from 'socket.io-client';
import { config } from '../../shared/config/env.js';

/**
 * Lazily-created, single shared Socket.IO client instance. Every part
 * of the app that needs the socket goes through getSocket() rather than
 * creating its own connection.
 */
let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(config.socketUrl, {
      autoConnect: false,
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      timeout: 10_000,
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
  }
}
