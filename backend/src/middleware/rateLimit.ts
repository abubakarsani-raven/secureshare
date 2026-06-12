import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { getRedis } from '../services/geoip';

function createLimiter(windowMs: number, max: number, prefix: string) {
  const redis = getRedis();
  const store =
    redis && (redis.status === 'ready' || redis.status === 'connecting')
      ? new RedisStore({
          sendCommand: (command: string, ...args: string[]) =>
            redis.call(command, ...args) as Promise<number>,
          prefix: `rl:${prefix}:`,
        })
      : undefined;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(store ? { store } : {}),
    message: { error: 'Too many requests' },
  });
}

export const authLimiter = createLimiter(15 * 60 * 1000, 20, 'auth');
export const otpLimiter = createLimiter(60 * 60 * 1000, 10, 'otp');
export const viewLimiter = createLimiter(60 * 1000, 60, 'view');
export const uploadLimiter = createLimiter(60 * 60 * 1000, 30, 'upload');
