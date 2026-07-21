import { Request, Response, NextFunction } from 'express';

/**
 * §17.3 — Middleware for the two internal endpoints consumed exclusively by apps/monitor.
 * Validates the shared `INTERNAL_MONITOR_KEY` secret passed in the X-Internal-Key header.
 * This is a server-to-server secret, never shown to end users.
 */
export function requireInternalKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-internal-key'] as string | undefined;
  const expected = process.env.INTERNAL_MONITOR_KEY;

  if (!expected) {
    // Misconfiguration — block rather than allow unrestricted access
    res.status(503).json({ error: 'INTERNAL_MONITOR_KEY is not configured on the server' });
    return;
  }

  if (!key || key !== expected) {
    res.status(401).json({ error: 'Invalid or missing X-Internal-Key header' });
    return;
  }

  next();
}
