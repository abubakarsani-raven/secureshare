import { Request } from 'express';
import { getSupabase } from './storage';
import { lookup } from './geoip';
import { sendEmail } from './mailer';
import { logger } from '../utils/logger';

const ALERT_LABELS: Record<string, string> = {
  possible_screenshot: 'Possible screenshot',
  screen_recording_attempt: 'Screen-recording attempt',
};

// In-memory throttle: at most one alert email per share+event per window, so a
// viewer hammering PrintScreen doesn't flood the sender's inbox. Per-instance
// and resets on restart — fine for a best-effort alert.
const lastAlert = new Map<string, number>();
const WINDOW_MS = 5 * 60 * 1000;

// Emails the share's sender when the viewer reports a likely screen capture.
// Fire-and-forget from the request handler — never block or fail the response.
export async function notifyCaptureEvent(shareId: string, event: string, req: Request): Promise<void> {
  // Only the high-signal events warrant an email; focus-loss is too noisy and is
  // left to the audit trail only.
  const label = ALERT_LABELS[event];
  if (!label) return;

  const key = `${shareId}:${event}`;
  const now = Date.now();
  if (now - (lastAlert.get(key) || 0) < WINDOW_MS) return;
  lastAlert.set(key, now);

  try {
    const supabase = getSupabase();
    const { data: share } = await supabase
      .from('shares')
      .select('recipient_name, type, sender_id')
      .eq('id', shareId)
      .single();
    if (!share) return;
    const { data: sender } = await supabase
      .from('users')
      .select('email')
      .eq('id', share.sender_id)
      .single();
    if (!sender?.email) return;

    const geo = await lookup(req.ip || '');
    const where = [geo.city, geo.country].filter(Boolean).join(', ') || 'unknown location';
    const when = new Date().toLocaleString();

    const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f4f4f5; padding:40px;">
  <div style="max-width:480px; margin:0 auto; background:#fff; border-radius:12px; padding:40px; box-shadow:0 4px 6px rgba(0,0,0,0.05);">
    <h1 style="color:#b45309; font-size:20px; margin:0 0 8px;">⚠ ${label}</h1>
    <p style="color:#3f3f46; font-size:15px;">A possible screen capture was detected on a secure ${share.type} you shared.</p>
    <table style="width:100%; font-size:14px; color:#3f3f46; margin:16px 0;">
      <tr><td style="color:#71717a; padding:4px 0;">Recipient</td><td>${share.recipient_name}</td></tr>
      <tr><td style="color:#71717a; padding:4px 0;">Event</td><td>${label}</td></tr>
      <tr><td style="color:#71717a; padding:4px 0;">Location (IP)</td><td>${where}</td></tr>
      <tr><td style="color:#71717a; padding:4px 0;">Time</td><td>${when}</td></tr>
    </table>
    <p style="color:#71717a; font-size:13px;">This is a best-effort signal, not proof — browsers cannot reliably detect screenshots, and a photo of the screen with another device is undetectable. Open your dashboard to see the full audit trail; if the content is leaked, the Leak Investigator can trace it to this recipient via the embedded watermark.</p>
  </div>
</body></html>`;

    await sendEmail(sender.email, `⚠ ${label} on your SecureShare`, html);
  } catch (err) {
    logger.warn('Capture alert email failed', { error: String(err) });
  }
}
