import { Router, Request, Response } from 'express';
import { authenticator } from 'otplib';
import { getSupabase } from '../services/storage';
import { hashPassword, verifyPassword } from '../services/tokenService';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../middleware/auth';
import { registerSchema, loginSchema, refreshSchema } from '../utils/validation';
import { authLimiter } from '../middleware/rateLimit';
import { logger } from '../utils/logger';

const router = Router();

router.post('/register', authLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { email, password } = parsed.data;
    const supabase = getSupabase();

    const { data: existing } = await supabase.from('users').select('id').eq('email', email).single();
    if (existing) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const totpSecret = authenticator.generateSecret();

    const { data: user, error } = await supabase
      .from('users')
      .insert({ email, password_hash: passwordHash, totp_secret: totpSecret })
      .select('id, email')
      .single();

    if (error || !user) {
      res.status(500).json({ error: 'Registration failed' });
      return;
    }

    const otpauthUrl = authenticator.keyuri(email, 'SecureShare', totpSecret);

    const accessToken = signAccessToken({ userId: user.id, email: user.email });
    const refreshToken = signRefreshToken({ userId: user.id, email: user.email });

    res.status(201).json({
      accessToken,
      refreshToken,
      totpSecret,
      otpauthUrl,
    });
  } catch (err) {
    logger.error('Register error', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { email, password, totpCode } = parsed.data;
    const supabase = getSupabase();

    const { data: user } = await supabase.from('users').select('*').eq('email', email).single();
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (user.totp_secret) {
      if (!totpCode) {
        res.status(401).json({ error: 'TOTP code required', requiresTotp: true });
        return;
      }
      const totpValid = authenticator.verify({ token: totpCode, secret: user.totp_secret });
      if (!totpValid) {
        res.status(401).json({ error: 'Invalid TOTP code' });
        return;
      }
    }

    const accessToken = signAccessToken({ userId: user.id, email: user.email });
    const refreshToken = signRefreshToken({ userId: user.id, email: user.email });

    res.json({ accessToken, refreshToken });
  } catch (err) {
    logger.error('Login error', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/refresh', authLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid refresh token' });
      return;
    }

    const payload = verifyRefreshToken(parsed.data.refreshToken);
    const accessToken = signAccessToken({ userId: payload.userId, email: payload.email });
    res.json({ accessToken });
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

export default router;
