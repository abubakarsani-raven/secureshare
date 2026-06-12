import { Router, Request, Response } from 'express';
import { otpSendSchema, otpVerifySchema } from '../utils/validation';
import { findShareByToken, isShareAccessible } from '../services/shareService';
import { hashEmail, deriveKeyFragment, safeCompare } from '../utils/helpers';
import { getSupabase } from '../services/storage';
import { generateOTP, sendOTP } from '../services/otpService';
import { hashOtp, verifyOtp } from '../services/tokenService';
import { signViewSession } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import { otpLimiter } from '../middleware/rateLimit';
import { incrementRateLimit } from '../services/geoip';
import { checkHoneypotAccess } from '../utils/honeypot';
import { logger } from '../utils/logger';

const router = Router();

router.post('/send', otpLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = otpSendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { token, email } = parsed.data;
    const share = await findShareByToken(token);
    if (!share) {
      res.status(404).json({ error: 'Share not found' });
      return;
    }

    if (await checkHoneypotAccess(share.id, share.recipient_name)) {
      res.status(404).json({ error: 'Share not found' });
      return;
    }

    const access = isShareAccessible(share);
    if (!access.ok) {
      res.status(403).json({ error: access.reason });
      return;
    }

    if (!share.otp_required) {
      res.json({ sent: true, otpRequired: false });
      return;
    }

    const emailHash = hashEmail(email);
    if (!safeCompare(emailHash, share.recipient_email_hash)) {
      res.status(403).json({ error: 'Email does not match recipient' });
      return;
    }

    // Increment first so concurrent requests cannot all pass a stale read
    const rateKey = `otp:send:${share.id}`;
    const count = await incrementRateLimit(rateKey, 3600);
    if (count > 3) {
      res.status(429).json({ error: 'Too many OTP requests' });
      return;
    }

    const code = generateOTP();
    const codeHash = await hashOtp(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const supabase = getSupabase();
    await supabase.from('otps').insert({
      share_id: share.id,
      code_hash: codeHash,
      expires_at: expiresAt.toISOString(),
    });

    await sendOTP(email, code, share.recipient_name, share.type);
    await logAudit(share.id, 'otp_sent', req);

    res.json({ sent: true });
  } catch (err) {
    logger.error('OTP send error', { error: String(err) });
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

router.post('/verify', otpLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = otpVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { token, email, code } = parsed.data;
    const share = await findShareByToken(token);
    if (!share) {
      res.status(404).json({ error: 'Share not found' });
      return;
    }

    if (await checkHoneypotAccess(share.id, share.recipient_name)) {
      res.status(404).json({ error: 'Share not found' });
      return;
    }

    const access = isShareAccessible(share);
    if (!access.ok) {
      res.status(403).json({ error: access.reason });
      return;
    }

    if (!share.otp_required) {
      const sessionToken = signViewSession({
        shareId: share.id,
        token,
        keyFragmentA: '',
      });
      res.json({ verified: true, sessionToken });
      return;
    }

    const emailHash = hashEmail(email);
    if (!safeCompare(emailHash, share.recipient_email_hash)) {
      res.status(403).json({ error: 'Email does not match recipient' });
      return;
    }

    const supabase = getSupabase();
    const { data: otps } = await supabase
      .from('otps')
      .select('*')
      .eq('share_id', share.id)
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1);

    const otp = otps?.[0];
    if (!otp) {
      res.status(400).json({ error: 'No OTP found' });
      return;
    }

    if (otp.attempts >= 3) {
      res.status(403).json({ error: 'Too many attempts', locked: true });
      return;
    }

    if (new Date(otp.expires_at) < new Date()) {
      res.status(400).json({ error: 'OTP expired' });
      return;
    }

    const valid = await verifyOtp(code, otp.code_hash);
    if (!valid) {
      // Atomic increment so parallel guesses cannot exceed the attempt cap
      const { data: newAttempts, error: rpcError } = await supabase.rpc('increment_otp_attempts', {
        p_otp_id: otp.id,
      });
      let attempts = typeof newAttempts === 'number' ? newAttempts : otp.attempts + 1;
      if (rpcError) {
        // Fallback for databases without the SQL function (pre-migration)
        await supabase.from('otps').update({ attempts: otp.attempts + 1 }).eq('id', otp.id);
        attempts = otp.attempts + 1;
      }
      if (attempts >= 3) {
        res.status(403).json({ error: 'Too many attempts', locked: true });
        return;
      }
      res.status(400).json({ error: 'Invalid code', attemptsRemaining: Math.max(0, 3 - attempts) });
      return;
    }

    await supabase.from('otps').update({ used: true }).eq('id', otp.id);

    const jwtSecret = process.env.JWT_SECRET || '';
    const keyFragmentA = deriveKeyFragment(code + share.id, 'fragmentA', jwtSecret);

    const sessionToken = signViewSession({
      shareId: share.id,
      token,
      keyFragmentA,
    });

    await logAudit(share.id, 'otp_verified', req);
    res.json({ verified: true, sessionToken });
  } catch (err) {
    logger.error('OTP verify error', { error: String(err) });
    res.status(500).json({ error: 'Verification failed' });
  }
});

export default router;
