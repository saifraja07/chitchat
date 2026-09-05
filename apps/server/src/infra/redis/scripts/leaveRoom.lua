-- KEYS[1] = room key (room:{roomId})
-- ARGV[1] = sessionId (the one leaving)
--
-- Returns:
--   nil                  -- room was already gone (someone else cleaned it up first)
--   {peerId, mode}        -- this call performed the cleanup; caller should notify peerId

local roomKey = KEYS[1]
local sessionId = ARGV[1]

if redis.call('EXISTS', roomKey) == 0 then
  return nil
end

local mode = redis.call('HGET', roomKey, 'mode')
local memberA = redis.call('HGET', roomKey, 'memberA')
local memberB = redis.call('HGET', roomKey, 'memberB')

local peerId = memberA
if memberA == sessionId then
  peerId = memberB
end

redis.call('DEL', roomKey)
redis.call('HDEL', 'session:' .. sessionId, 'roomId')
redis.call('HDEL', 'session:' .. peerId, 'roomId')

return {peerId, mode}
