/**
 * Atomic reserve. CLAUDE.md: check-and-increment must be ONE script, or twenty
 * parallel uploads from one phone all observe the same pre-increment count and
 * every one of them passes.
 *
 * KEYS[1] rolling-window sorted set, KEYS[2] lifetime counter (grace tracking).
 * Both carry the same hash tag so they land on one slot under Redis Cluster.
 *
 * Grace uploads are counted in the lifetime counter only; they never enter the
 * window. "The first N bypass Bloom entirely" is taken literally.
 */
export const RESERVE_LUA = `
local zkey      = KEYS[1]
local lkey      = KEYS[2]
local now       = tonumber(ARGV[1])
local windowMs  = tonumber(ARGV[2])
local limit     = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])
local grace     = tonumber(ARGV[5])
local ttl       = tonumber(ARGV[6])

redis.call('ZREMRANGEBYSCORE', zkey, '-inf', now - windowMs)

local lifetime   = tonumber(redis.call('GET', lkey) or '0')
local used       = redis.call('ZCARD', zkey)
local graceLeft  = math.max(0, grace - lifetime)
local fromGrace  = math.min(requested, graceLeft)
local windowRoom = math.max(0, limit - used)
local fromWindow = math.min(requested - fromGrace, windowRoom)
local granted    = fromGrace + fromWindow

local members = {}
for i = 1, fromWindow do
  local member = ARGV[6 + i]
  redis.call('ZADD', zkey, now, member)
  members[#members + 1] = member
end

if granted > 0 then
  redis.call('INCRBY', lkey, granted)
end

redis.call('PEXPIRE', zkey, ttl)
redis.call('PEXPIRE', lkey, ttl)

local usedAfter     = redis.call('ZCARD', zkey)
local lifetimeAfter = lifetime + granted
local graceRemain   = math.max(0, grace - lifetimeAfter)
local windowRemain  = math.max(0, limit - usedAfter)

local resetAt = 0
if windowRemain == 0 then
  local oldest = redis.call('ZRANGE', zkey, 0, 0, 'WITHSCORES')
  if oldest[2] then resetAt = tonumber(oldest[2]) + windowMs end
end

return {
  granted,
  fromGrace,
  graceRemain + windowRemain,
  usedAfter,
  math.floor(resetAt),
  cjson.encode(members)
}
`;

/**
 * Release a reservation when an upload fails or is cancelled. Must undo both the
 * window entry and the lifetime counter, because the reserved slot may have come
 * from either pool and the caller does not know which.
 */
export const RELEASE_LUA = `
local zkey   = KEYS[1]
local lkey   = KEYS[2]
local member = ARGV[1]

redis.call('ZREM', zkey, member)
local lifetime = tonumber(redis.call('GET', lkey) or '0')
if lifetime > 0 then
  redis.call('DECR', lkey)
end
return 1
`;
