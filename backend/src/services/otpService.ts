import { Resend } from 'resend';
import { logger } from '../utils/logger';

let resend: Resend | null = null;

function getResend(): Resend {
  if (!resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('RESEND_API_KEY not set');
    resend = new Resend(apiKey);
  }
  return resend;
}

import { randomInt } from 'crypto';

export function generateOTP(): string {
  return Array.from({ length: 6 }, () => randomInt(0, 10).toString()).join('');
}

function emailDisabled(): boolean {
  const key = process.env.RESEND_API_KEY;
  return !key || key.includes('placeholder');
}

export async function sendOTP(
  email: string,
  code: string,
  recipientName: string,
  shareType: string
): Promise<void> {
  // Dev fallback: without a real Resend key, surface the code in the terminal
  // instead of silently "sending" nothing.
  if (emailDisabled()) {
    logger.warn(`[DEV ONLY] Email disabled (no RESEND_API_KEY) — OTP code for ${email}: ${code}`);
    return;
  }

  const from = process.env.RESEND_FROM_EMAIL || 'noreply@secureshare.app';
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f4f4f5; padding: 40px;">
  <div style="max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 40px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
    <div style="text-align: center; margin-bottom: 24px;">
      <h1 style="color: #18181b; font-size: 24px; margin: 0;">SecureShare</h1>
      <p style="color: #71717a; margin-top: 8px;">Secure file sharing</p>
    </div>
    <p style="color: #3f3f46; font-size: 16px;">Hello ${recipientName},</p>
    <p style="color: #3f3f46; font-size: 16px;">Someone shared a secure ${shareType} with you. Your verification code is:</p>
    <div style="background: #f4f4f5; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
      <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #18181b;">${code}</span>
    </div>
    <p style="color: #71717a; font-size: 14px;">This code expires in 10 minutes.</p>
    <p style="color: #71717a; font-size: 14px;">If you did not request this, please ignore this email.</p>
  </div>
</body>
</html>`;

  try {
    // The Resend SDK reports API failures via the returned error field rather
    // than throwing — ignoring it means "sent" responses for mail that never left.
    const { error } = await getResend().emails.send({
      from,
      to: email,
      subject: 'Your SecureShare verification code',
      html,
    });
    if (error) {
      logger.error('Resend rejected OTP email', { email, error: error.message });
      throw new Error('Failed to send verification email');
    }
  } catch (err) {
    logger.error('Failed to send OTP email', { email, error: String(err) });
    throw new Error('Failed to send verification email');
  }
}
