import { NextFunction, Request, Response } from 'express';
import { gzipSync } from 'node:zlib';

const MIN_GZIP_BYTES = 1024;

export function gzipJsonResponses(req: Request, res: Response, next: NextFunction): void {
  const acceptsEncoding = req.headers['accept-encoding'];
  if (typeof acceptsEncoding !== 'string' || !acceptsEncoding.includes('gzip')) {
    next();
    return;
  }

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    const payload = JSON.stringify(body);
    if (payload.length < MIN_GZIP_BYTES) {
      return originalJson(body);
    }

    const gzipped = gzipSync(Buffer.from(payload));
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', String(gzipped.length));
    return res.send(gzipped);
  }) as Response['json'];

  next();
}
