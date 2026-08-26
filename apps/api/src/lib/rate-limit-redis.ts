import Redis from 'ioredis';
import { env } from '@cms/config';

// Dedicated ioredis client for @fastify/rate-limit. Kept separate from the
// BullMQ producer client in @cms/queue: BullMQ requires
// maxRetriesPerRequest=null + enableReadyCheck=false (blocking commands),
// whereas rate-limit wants the default fail-fast behaviour so a transient
// Dragonfly hiccup doesn't queue requests. Connection ceiling on Dragonfly
// is in the thousands — one extra socket per API process is free.
//
// lazyConnect: true means importing this file doesn't open a TCP connection;
// the plugin calls .connect() (or the first command does) on demand.
let client: Redis | null = null;

export function getRateLimitRedis(): Redis {
  client ??= new Redis(env.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  return client;
}
