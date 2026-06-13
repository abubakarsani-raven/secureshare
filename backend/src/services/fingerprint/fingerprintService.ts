import {
  recommendedLength,
  accusationThreshold,
  generateBias,
  generateCodeword,
  accuse,
  unpackBits,
  Accusation,
} from './tardos';
import { extractFingerprintImage } from './fingerprintEmbed';
import { getSupabase } from '../storage';
import { getWatermarkSecret } from '../encryption';
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

// Extracts the spread-spectrum fingerprint from a leaked image and scores every
// recipient in the campaign, returning them ranked. The extraction degrades
// gracefully (JPEG, splicing), so even a colluded copy points at a true leaker.
export async function traceImageLeak(
  batchId: string,
  imageBuffer: Buffer,
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

  let extractedBits: Int8Array;
  try {
    extractedBits = await extractFingerprintImage(imageBuffer, length, getWatermarkSecret());
  } catch (err) {
    logger.warn('Fingerprint extraction failed', { error: String(err) });
    return null;
  }

  const { data: shares } = await supabase
    .from('shares')
    .select('id, recipient_name, recipient_email_hint, fingerprint')
    .eq('batch_id', batchId);
  if (!shares || shares.length === 0) return null;

  const withCodes = shares.filter((s) => s.fingerprint);
  if (withCodes.length === 0) return null;
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
