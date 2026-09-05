-- KEYS[1] = queue member key (queue:member:{sessionId})
-- ARGV[1] = sessionId
--
-- Returns:
--   nil    -- session wasn't queued (already matched, or never joined)
--   mode   -- the mode it was removed from

local memberKey = KEYS[1]
local sessionId = ARGV[1]

local mode = redis.call('GET', memberKey)
if not mode then
  return nil
end

redis.call('DEL', memberKey)
redis.call('LREM', 'queue:' .. mode, 0, sessionId)
redis.call('HDEL', 'session:' .. sessionId, 'mode')

return mode
