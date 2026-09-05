-- KEYS[1] = queue list key (queue:{mode})
-- KEYS[2] = queue member key for the joining session (queue:member:{sessionId})
-- KEYS[3] = session key for the joining session (session:{sessionId})
-- ARGV[1] = sessionId (joining)
-- ARGV[2] = mode ('video' | 'chat')
-- ARGV[3] = roomId to use if a match is made
-- ARGV[4] = queue member TTL (seconds)
-- ARGV[5] = room TTL (seconds, safety-net only)
-- ARGV[6] = now (ms, for room bookkeeping)
--
-- Returns one of:
--   {2, 'already_in_room'}   -- session already has an active room
--   {2, 'already_queued'}    -- session is already waiting in a queue
--   {1, roomId, peerId}      -- matched immediately
--   {0}                      -- enqueued, waiting

local queueKey = KEYS[1]
local memberKey = KEYS[2]
local sessionKey = KEYS[3]

local sessionId = ARGV[1]
local mode = ARGV[2]
local roomId = ARGV[3]
local memberTtl = tonumber(ARGV[4])
local roomTtl = tonumber(ARGV[5])
local now = ARGV[6]

-- Guard: never let one session end up in two places at once.
local existingRoomId = redis.call('HGET', sessionKey, 'roomId')
if existingRoomId then
  return {2, 'already_in_room'}
end
if redis.call('EXISTS', memberKey) == 1 then
  return {2, 'already_queued'}
end

-- Look for a valid waiting peer, discarding any stale entries we find
-- along the way (a queue:member key that expired but whose list entry
-- is still present).
while true do
  local peerId = redis.call('LPOP', queueKey)
  if not peerId then
    break
  end

  if peerId ~= sessionId then
    local peerMemberKey = 'queue:member:' .. peerId
    local peerMode = redis.call('GET', peerMemberKey)

    if peerMode == mode then
      redis.call('DEL', peerMemberKey)

      local roomKey = 'room:' .. roomId
      redis.call('HSET', roomKey, 'mode', mode, 'memberA', peerId, 'memberB', sessionId, 'createdAt', now)
      redis.call('EXPIRE', roomKey, roomTtl)

      redis.call('HSET', 'session:' .. peerId, 'roomId', roomId, 'mode', mode)
      redis.call('HSET', sessionKey, 'roomId', roomId, 'mode', mode)

      return {1, roomId, peerId}
    end
    -- stale entry: peerMode was nil (expired) or mismatched mode; drop and keep scanning.
  end
end

-- No valid peer waiting: take our place in line.
redis.call('RPUSH', queueKey, sessionId)
redis.call('SET', memberKey, mode, 'EX', memberTtl)
redis.call('HSET', sessionKey, 'mode', mode)

return {0}
