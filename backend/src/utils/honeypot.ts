import { getSupabase } from '../services/storage';
import { generateToken, hashToken } from '../services/tokenService';
import { tokenLookup, generateWatermarkSeed } from '../utils/helpers';
import { logger } from '../utils/logger';

export async function generateHoneypotTokens(): Promise<void> {
  try {
    const supabase = getSupabase();
    for (let i = 0; i < 5; i++) {
      const token = generateToken();
      const tokenHash = await hashToken(token);
      const lookup = tokenLookup(token);
      await supabase.from('shares').insert({
        token_hash: tokenHash,
        token_lookup: lookup,
        type: 'message',
        recipient_name: 'HONEYPOT',
        recipient_email_hash: 'honeypot',
        recipient_email_hint: 'h***@honeypot.internal',
        watermark_seed: generateWatermarkSeed(),
        max_views: 0,
        otp_required: false,
      });
    }
    logger.info('Honeypot tokens generated');
  } catch (err) {
    logger.warn('Failed to generate honeypot tokens', { error: String(err) });
  }
}

export async function checkHoneypotAccess(shareId: string, recipientName: string): Promise<boolean> {
  if (recipientName === 'HONEYPOT') {
    logger.error('HONEYPOT TOKEN ACCESSED', { shareId, alert: true });
    return true;
  }
  return false;
}
