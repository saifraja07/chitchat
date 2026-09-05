import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(__dirname, 'scripts');

function loadScript(filename) {
  return readFileSync(path.join(SCRIPTS_DIR, filename), 'utf8');
}

/**
 * Registers every matchmaking Lua script as a named command on the given
 * ioredis client (e.g. client.enqueueOrMatch(...)). Safe to call more
 * than once on the same client — ioredis just overwrites the definition.
 */
export function registerMatchmakingCommands(redis) {
  redis.defineCommand('enqueueOrMatch', {
    numberOfKeys: 3,
    lua: loadScript('enqueueOrMatch.lua'),
  });

  redis.defineCommand('leaveRoom', {
    numberOfKeys: 1,
    lua: loadScript('leaveRoom.lua'),
  });

  redis.defineCommand('leaveQueue', {
    numberOfKeys: 1,
    lua: loadScript('leaveQueue.lua'),
  });
}
