import { Resend } from 'resend';
import { logger } from '../utils/logger';

// Shared transactional-email helper (Resend). OTP delivery has its own bespoke
// template in otpService; this is the generic sender for everything else.
let resend: Resend | null = null;
function getResend(): Resend {
  if (!resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('RESEND_API_KEY not set');
    resend = new Resend(apiKey);
  }
  return resend;
}

// Treat a missing or placeholder key as "email disabled" so local/dev runs log
// instead of erroring.
export function emailDisabled(): boolean {
  const key = process.env.RESEND_API_KEY;
  return !key || key.includes('placeholder');
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (emailDisabled()) {
    logger.warn(`[DEV ONLY] Email disabled (no RESEND_API_KEY) — would send "${subject}" to ${to}`);
    return;
  }
  const from = process.env.RESEND_FROM_EMAIL || 'noreply@secureshare.app';
  // Resend reports failures via the returned error field rather than throwing.
  const { error } = await getResend().emails.send({ from, to, subject, html });
  if (error) {
    logger.error('Resend rejected email', { to, subject, error: error.message });
    throw new Error('Failed to send email');
  }
}
