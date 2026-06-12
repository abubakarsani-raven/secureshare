import { extractLSB } from './lsbWatermark';
import { extractDCT } from './dctWatermark';
import { WatermarkPayload } from './lsbWatermark';

export async function extractWatermark(imageBuffer: Buffer): Promise<{
  found: boolean;
  payload: WatermarkPayload | null;
  method: string | null;
}> {
  const lsb = await extractLSB(imageBuffer);
  if (lsb) return { found: true, payload: lsb, method: 'lsb' };

  const dct = await extractDCT(imageBuffer);
  if (dct) return { found: true, payload: dct, method: 'dct' };

  return { found: false, payload: null, method: null };
}
