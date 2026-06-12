import { getSupabase } from './storage';
import { verifyToken } from './tokenService';
import { tokenLookup } from '../utils/helpers';

export interface ShareRecord {
  id: string;
  sender_id: string | null;
  token_hash: string;
  token_lookup: string | null;
  type: string;
  storage_path: string | null;
  ciphertext: string | null;
  key_fragment_b: string | null;
  recipient_name: string;
  recipient_email_hash: string;
  recipient_email_hint: string;
  max_views: number;
  view_count: number;
  expires_at: string | null;
  revoked: boolean;
  otp_required: boolean;
  ip_bound: string | null;
  device_bound: string | null;
  geo_allowed: string[] | null;
  time_window_start: string | null;
  time_window_end: string | null;
  watermark_seed: string;
  self_destruct_seconds: number | null;
  destroyed_at: string | null;
  page_count: number | null;
  duration_seconds: number | null;
  chunk_count: number | null;
  created_at: string;
}

export async function findShareByToken(token: string): Promise<ShareRecord | null> {
  const lookup = tokenLookup(token);
  const supabase = getSupabase();
  const { data: candidates } = await supabase
    .from('shares')
    .select('*')
    .eq('token_lookup', lookup);

  if (!candidates || candidates.length === 0) return null;

  for (const share of candidates) {
    const valid = await verifyToken(token, share.token_hash);
    if (valid) return share as ShareRecord;
  }
  return null;
}

export function isShareAccessible(
  share: ShareRecord,
  options?: { ignoreMaxViews?: boolean }
): { ok: boolean; reason?: string } {
  if (share.revoked) return { ok: false, reason: 'revoked' };
  if (share.destroyed_at) return { ok: false, reason: 'destroyed' };
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return { ok: false, reason: 'expired' };
  }
  // Content endpoints pass ignoreMaxViews: the view was already consumed when the
  // session fetched /info, and page/segment requests within that session must not
  // be locked out by their own increment.
  if (!options?.ignoreMaxViews && share.max_views > 0 && share.view_count >= share.max_views) {
    return { ok: false, reason: 'max_views' };
  }
  return { ok: true };
}

export async function incrementViewCount(shareId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('increment_view_count', { p_share_id: shareId });
  if (error) {
    // Fallback for databases without the SQL function (pre-migration)
    const { data: share } = await supabase.from('shares').select('view_count').eq('id', shareId).single();
    if (share) {
      await supabase.from('shares').update({ view_count: share.view_count + 1 }).eq('id', shareId);
    }
  }
}
