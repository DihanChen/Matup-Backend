import { NextFunction, Request, Response } from 'express';
import { AuthenticatedRequest } from './auth';

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyGenerator: (req: Request) => string;
  errorMessage: string;
};

type Bucket = {
  count: number;
  windowStartMs: number;
};

function createRateLimitMiddleware(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = options.keyGenerator(req);
    const existing = buckets.get(key);

    if (!existing || now - existing.windowStartMs >= options.windowMs) {
      buckets.set(key, { count: 1, windowStartMs: now });
      next();
      return;
    }

    if (existing.count >= options.max) {
      const retryAfterSeconds = Math.ceil(
        (options.windowMs - (now - existing.windowStartMs)) / 1000
      );
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({ error: options.errorMessage });
      return;
    }

    existing.count += 1;
    buckets.set(key, existing);
    next();
  };
}

export const emailSendRateLimit = createRateLimitMiddleware({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => {
    const authReq = req as AuthenticatedRequest;
    return authReq.userId || req.ip || 'unknown';
  },
  errorMessage: 'Too many email requests. Please try again in a minute.',
});

export const courtsOsmRateLimit = createRateLimitMiddleware({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.ip || 'unknown',
  errorMessage: 'Too many OSM requests. Please try again in a minute.',
});
