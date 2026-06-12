import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthPayload {
  userId: string;
  email: string;
}

export interface ViewSessionPayload {
  shareId: string;
  token: string;
  keyFragmentA: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
      viewSession?: ViewSessionPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const token = header.slice(7);
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET not set');
    const payload = jwt.verify(token, secret) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireViewSession(req: Request, res: Response, next: NextFunction): void {
  // Safari's native HLS player cannot attach custom headers to playlist/segment
  // requests, so the session JWT is also accepted as a query parameter there.
  const header = req.headers['x-view-session'];
  const query = req.query.session;
  const token =
    typeof header === 'string' && header ? header : typeof query === 'string' ? query : '';
  if (!token) {
    res.status(401).json({ error: 'View session required' });
    return;
  }
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET not set');
    const payload = jwt.verify(token, secret) as ViewSessionPayload;
    req.viewSession = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid view session' });
  }
}

export function signAccessToken(payload: AuthPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set');
  return jwt.sign(payload, secret, { expiresIn: '24h' });
}

export function signRefreshToken(payload: AuthPayload): string {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error('JWT_REFRESH_SECRET not set');
  return jwt.sign(payload, secret, { expiresIn: '7d' });
}

export function verifyRefreshToken(token: string): AuthPayload {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error('JWT_REFRESH_SECRET not set');
  return jwt.verify(token, secret) as AuthPayload;
}

export function signViewSession(payload: ViewSessionPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set');
  return jwt.sign(payload, secret, { expiresIn: '1h' });
}
