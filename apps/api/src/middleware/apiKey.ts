import { Request, Response, NextFunction } from 'express';
import { prisma } from '@oncallx/shared';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      service?: { id: string; teamId: string; name: string };
    }
  }
}

// Validates the X-Api-Key header against per-service API keys
export async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (!apiKey) {
    res.status(401).json({ error: 'Missing X-Api-Key header' });
    return;
  }

  const service = await prisma.service.findUnique({ where: { apiKey } });
  if (!service) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  req.service = service;
  next();
}
