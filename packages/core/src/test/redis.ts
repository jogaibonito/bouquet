import Redis from 'ioredis';

export function testRedis(): Redis {
  return new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });
}

let n = 0;
export const uniqueIds = (count: number, prefix = 'up') =>
  Array.from({ length: count }, () => `${prefix}-${++n}`);
