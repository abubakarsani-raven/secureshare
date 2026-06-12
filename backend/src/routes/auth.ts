import { Router, Request, Response } from 'express';
import { authenticator } from 'otplib';
import { getSupabase } from '../services/storage';
import { hashPassword, verifyPassword } from '../services/tokenService';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  requireAuth,
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
      // Deliberately generic to avoid confirming which emails are registered
      res.status(400).json({ error: 'Unable to register with this email' });
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

    // Only enforce TOTP once the user has confirmed their authenticator setup;
    // otherwise a user who never scanned the QR would be locked out forever.
    if (user.totp_secret && user.totp_enabled) {
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

router.post('/totp/confirm', authLimiter, requireAuth, async (req: Request, res: Response) => {
  try {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!/^\d{6}$/.test(code)) {
      res.status(400).json({ error: 'A 6-digit code is required' });
      return;
    }

    const supabase = getSupabase();
    const { data: user } = await supabase
      .from('users')
      .select('id, totp_secret, totp_enabled')
      .eq('id', req.user!.userId)
      .single();

    if (!user?.totp_secret) {
      res.status(400).json({ error: 'TOTP not set up' });
      return;
    }

    const valid = authenticator.verify({ token: code, secret: user.totp_secret });
    if (!valid) {
      res.status(400).json({ error: 'Invalid TOTP code' });
      return;
    }

    await supabase.from('users').update({ totp_enabled: true }).eq('id', user.id);
    res.json({ enabled: true });
  } catch (err) {
    logger.error('TOTP confirm error', { error: String(err) });
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
