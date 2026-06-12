import Redis from 'ioredis';
import axios from 'axios';
import { logger } from '../utils/logger';

let redis: Redis | null = null;

// In-memory fallbacks used when Redis is not configured or unavailable,
// so geo caching and OTP rate limits still work in a no-Docker setup.
const memoryCache = new Map<string, { value: string; expiresAt: number }>();
const memoryCounters = new Map<string, { count: number; expiresAt: number }>();

function memoryGet(key: string): string | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

function memorySet(key: string, value: string, ttlSeconds: number): void {
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });
    redis.on('error', (err) => logger.warn('Redis error', { error: err.message }));
  }
  return redis;
}

export async function connectRedis(): Promise<void> {
  const client = getRedis();
  if (!client) {
    logger.info('REDIS_URL not set — using in-memory rate limiting and geo cache');
    return;
  }
  if (client.status !== 'ready') {
    await client.connect().catch(() => {
      logger.warn('Redis connection failed, falling back to in-memory store');
    });
  }
}

export interface GeoResult {
  country: string;
  city: string;
  isp: string;
}

export async function lookup(ip: string): Promise<GeoResult> {
  const defaultResult: GeoResult = { country: 'Unknown', city: 'Unknown', isp: 'Unknown' };
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.')) {
    return defaultResult;
  }

  const cacheKey = `geo:${ip}`;
  try {
    const client = getRedis();
    if (client && client.status === 'ready') {
      const cached = await client.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } else {
      const cached = memoryGet(cacheKey);
      if (cached) return JSON.parse(cached);
    }
  } catch {
    // continue without cache
  }

  try {
    const response = await axios.get(
      `http://ip-api.com/json/${ip}?fields=country,city,isp,status`,
      { timeout: 5000 }
    );
    const data = response.data;
    if (data.status === 'fail') return defaultResult;
    const result: GeoResult = {
      country: data.country || 'Unknown',
      city: data.city || 'Unknown',
      isp: data.isp || 'Unknown',
    };

    try {
      const client = getRedis();
      if (client && client.status === 'ready') {
        await client.setex(cacheKey, 86400, JSON.stringify(result));
      } else {
        memorySet(cacheKey, JSON.stringify(result), 86400);
      }
    } catch {
      // ignore cache write failure
    }

    return result;
  } catch (err) {
    logger.warn('GeoIP lookup failed', { ip, error: String(err) });
    return defaultResult;
  }
}

export async function incrementRateLimit(key: string, ttlSeconds: number): Promise<number> {
  try {
    const client = getRedis();
    if (client && client.status === 'ready') {
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, ttlSeconds);
      return count;
    }
  } catch {
    // fall through to memory counter
  }
  const now = Date.now();
  const entry = memoryCounters.get(key);
  if (!entry || entry.expiresAt < now) {
    memoryCounters.set(key, { count: 1, expiresAt: now + ttlSeconds * 1000 });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

export async function getRateLimitCount(key: string): Promise<number> {
  try {
    const client = getRedis();
    if (client && client.status === 'ready') {
      const val = await client.get(key);
      return val ? parseInt(val, 10) : 0;
    }
  } catch {
    // fall through to memory counter
  }
  const entry = memoryCounters.get(key);
  if (!entry || entry.expiresAt < Date.now()) return 0;
  return entry.count;
}
