import { Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { getRedis } from '../services/geoip';

// Limiters are built lazily on first request rather than at import time:
// the Redis connection is only established in start() (after this module is
// imported), so building eagerly would always silently fall back to the
// in-memory store even when REDIS_URL is configured.
function createLimiter(windowMs: number, max: number, prefix: string): RequestHandler {
  let limiter: RateLimitRequestHandler | null = null;

  return (req: Request, res: Response, next: NextFunction) => {
    if (!limiter) {
      const redis = getRedis();
      const store =
        redis && redis.status === 'ready'
          ? new RedisStore({
              sendCommand: (command: string, ...args: string[]) =>
                redis.call(command, ...args) as Promise<number>,
              prefix: `rl:${prefix}:`,
            })
          : undefined;

      limiter = rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        ...(store ? { store } : {}),
        message: { error: 'Too many requests' },
      });
    }
    limiter(req, res, next);
  };
}

export const authLimiter = createLimiter(15 * 60 * 1000, 20, 'auth');
export const otpLimiter = createLimiter(60 * 60 * 1000, 10, 'otp');
export const viewLimiter = createLimiter(60 * 1000, 60, 'view');
export const uploadLimiter = createLimiter(60 * 60 * 1000, 30, 'upload');
