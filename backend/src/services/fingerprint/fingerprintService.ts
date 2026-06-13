import {
  recommendedLength,
  accusationThreshold,
  generateBias,
  generateCodeword,
  accuse,
  unpackBits,
  Accusation,
} from './tardos';
import { getSupabase } from '../storage';
import { logger } from '../../utils/logger';

// Resistance target: any coalition of up to this many recipients colluding on a
// single leaked copy. Code length scales with c^2, so this is a cost/strength knob.
const MAX_COLLUDERS = 4;

export interface CampaignFingerprints {
  length: number;
  bias: number[];
  codewords: Uint8Array[]; // one per recipient, in order
}

export function buildCampaignFingerprints(numRecipients: number): CampaignFingerprints {
  const length = recommendedLength(MAX_COLLUDERS, Math.max(numRecipients, 2));
  const bias = generateBias(length, MAX_COLLUDERS);
  const codewords = Array.from({ length: numRecipients }, () => generateCodeword(bias));
  return { length, bias, codewords };
}

// Persists the secret bias so a future leak can be scored. Best-effort: if the
// campaigns table isn't migrated yet, fingerprinting is simply skipped.
export async function saveCampaign(
  batchId: string,
  senderId: string,
  fp: CampaignFingerprints
): Promise<boolean> {
  try {
    const { error } = await getSupabase().from('campaigns').insert({
      batch_id: batchId,
      sender_id: senderId,
      code_length: fp.length,
      max_colluders: MAX_COLLUDERS,
      bias: JSON.stringify(fp.bias),
    });
    if (error) {
      logger.warn('Fingerprint campaign not saved (migration pending?)', { error: error.message });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('Fingerprint campaign save failed', { error: String(err) });
    return false;
  }
}

export interface TraceResult {
  recipientName: string;
  emailHint: string;
  shareId: string;
  score: number;
  accused: boolean;
}

// Scores every recipient in a campaign against the fingerprint extracted from a
// leaked copy and returns them ranked. Even a colluded/spliced copy points at a
// true leaker. `extractedFpB64` is the codeword recovered from the leaked file.
export async function traceLeak(
  batchId: string,
  extractedFpB64: string,
  senderId?: string
): Promise<{ threshold: number; ranked: TraceResult[] } | null> {
  const supabase = getSupabase();
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('code_length, bias, sender_id')
    .eq('batch_id', batchId)
    .single();
  if (!campaign) return null;
  if (senderId && campaign.sender_id !== senderId) return null;

  const bias: number[] = JSON.parse(campaign.bias);
  const length: number = campaign.code_length;
  const extractedBits = unpackBits(extractedFpB64, length);

  const { data: shares } = await supabase
    .from('shares')
    .select('id, recipient_name, recipient_email_hint, fingerprint')
    .eq('batch_id', batchId);
  if (!shares || shares.length === 0) return null;

  const withCodes = shares.filter((s) => s.fingerprint);
  const codewords = withCodes.map((s) => unpackBits(s.fingerprint as string, length));
  const threshold = accusationThreshold(length, withCodes.length, 1e-3);
  const accusations: Accusation[] = accuse(extractedBits, codewords, bias, threshold);

  const ranked: TraceResult[] = accusations.map((a) => ({
    recipientName: withCodes[a.index].recipient_name,
    emailHint: withCodes[a.index].recipient_email_hint,
    shareId: withCodes[a.index].id,
    score: a.score,
    accused: a.accused,
  }));

  return { threshold, ranked };
}
