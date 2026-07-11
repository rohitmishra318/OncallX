import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma, redis } from '@oncallx/shared';
import { REFRESH_TOKEN_PREFIX } from '@oncallx/shared';

export const authRouter = Router();

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

function signAccessToken(userId: string, teamId: string, role: string): string {
  return jwt.sign(
    { userId, teamId, role },
    process.env.JWT_ACCESS_SECRET ?? '',
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

async function createRefreshToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(40).toString('hex');
  const hashed = crypto.createHash('sha256').update(token).digest('hex');
  await redis.set(
    `${REFRESH_TOKEN_PREFIX}${userId}`,
    hashed,
    'EX',
    REFRESH_TOKEN_EXPIRY_SECONDS
  );
  return token;
}

// POST /auth/register
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  teamId: z.string().uuid(),
  role: z.enum(['ADMIN', 'RESPONDER', 'VIEWER']),
});

authRouter.post('/register', async (req: Request, res: Response): Promise<void> => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { email, password, name, teamId, role } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: 'Email already in use' });
    return;
  }

  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, passwordHash, name, teamId, role },
  });

  res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

// POST /auth/login
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const accessToken = signAccessToken(user.id, user.teamId, user.role);
  const refreshToken = await createRefreshToken(user.id);

  res.json({ accessToken, refreshToken, userId: user.id, teamId: user.teamId, role: user.role });
});

// POST /auth/refresh
const refreshSchema = z.object({
  refreshToken: z.string(),
  userId: z.string().uuid(),
});

authRouter.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { refreshToken, userId } = parsed.data;

  const storedHash = await redis.get(`${REFRESH_TOKEN_PREFIX}${userId}`);
  if (!storedHash) {
    res.status(401).json({ error: 'Refresh token expired or not found' });
    return;
  }

  const incomingHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  if (incomingHash !== storedHash) {
    res.status(401).json({ error: 'Invalid refresh token' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }

  // Rotate: delete old token, issue new pair
  await redis.del(`${REFRESH_TOKEN_PREFIX}${userId}`);
  const newAccessToken = signAccessToken(user.id, user.teamId, user.role);
  const newRefreshToken = await createRefreshToken(user.id);

  res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
});
