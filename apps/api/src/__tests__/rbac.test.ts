// Unit tests for RBAC middleware
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { requireAuth, requireRole } from '../middleware/auth';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

const SECRET = process.env.JWT_ACCESS_SECRET ?? 'test_access_secret_32_chars_min!!';

describe('requireAuth middleware', () => {
  it('rejects requests with no Authorization header', () => {
    const req = mockReq({ headers: {} });
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects requests with invalid token', () => {
    const req = mockReq({ headers: { authorization: 'Bearer invalid.token.here' } });
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts valid JWT and attaches user to req', () => {
    const token = jwt.sign(
      { userId: 'user-1', teamId: 'team-1', role: 'RESPONDER' },
      SECRET,
      { expiresIn: '15m' }
    );
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as any).user?.role).toBe('RESPONDER');
    expect((req as any).user?.teamId).toBe('team-1');
  });
});

describe('requireRole middleware', () => {
  function makeAuthedReq(role: string): Request {
    return {
      headers: {},
      user: { userId: 'u1', teamId: 't1', role },
    } as unknown as Request;
  }

  it('allows ADMIN when ADMIN role is required', () => {
    const req = makeAuthedReq('ADMIN');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireRole('ADMIN')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows RESPONDER when RESPONDER or ADMIN is required', () => {
    const req = makeAuthedReq('RESPONDER');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireRole('RESPONDER', 'ADMIN')(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('blocks VIEWER from RESPONDER+ routes', () => {
    const req = makeAuthedReq('VIEWER');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireRole('RESPONDER', 'ADMIN')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('blocks RESPONDER from ADMIN-only routes', () => {
    const req = makeAuthedReq('RESPONDER');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireRole('ADMIN')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 if req.user is not set', () => {
    const req = { headers: {}, user: undefined } as unknown as Request;
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireRole('ADMIN')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
