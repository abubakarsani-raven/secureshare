import { getSupabase } from '../services/storage';
import { generateToken, hashToken } from '../services/tokenService';
import { tokenLookup, generateWatermarkSeed } from '../utils/helpers';
import { logger } from '../utils/logger';

export async function generateHoneypotTokens(): Promise<void> {
  try {
    const supabase = getSupabase();

    // Only seed once — regenerating on every boot would grow the table forever
    // and orphan previously planted tokens.
    const { count } = await supabase
      .from('shares')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_name', 'HONEYPOT');
    if (count && count > 0) return;

    const plantedUrls: string[] = [];
    const base = process.env.FRONTEND_URL || 'http://localhost:3000';
    for (let i = 0; i < 5; i++) {
      const token = generateToken();
      const tokenHash = await hashToken(token);
      const lookup = tokenLookup(token);
      await supabase.from('shares').insert({
        token_hash: tokenHash,
        token_lookup: lookup,
        token_prefix: token.slice(0, 8),
        type: 'message',
        recipient_name: 'HONEYPOT',
        recipient_email_hash: 'honeypot',
        recipient_email_hint: 'h***@honeypot.internal',
        watermark_seed: generateWatermarkSeed(),
        max_views: 0,
        otp_required: false,
      });
      plantedUrls.push(`${base}/view/${token}`);
    }
    // Tokens are stored only as hashes; log the URLs once so an operator can
    // plant them (paste sites, decoy docs, etc.) — otherwise they catch nothing.
    logger.info('Honeypot tokens generated — plant these URLs where leaks would surface', {
      urls: plantedUrls,
    });
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
