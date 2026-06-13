import sharp from 'sharp';
import { embedDCT } from '../watermark/dctWatermark';
import { embedLSB } from '../watermark/lsbWatermark';
import { WatermarkPayload } from '../watermark/lsbWatermark';
import {
  encryptBuffer,
  serializeEncrypted,
  getEncryptionKey,
  getWatermarkSecret,
} from '../encryption';
import { embedFingerprintImage } from '../fingerprint/fingerprintEmbed';
import { uploadFile } from '../storage';

const MAX_DIMENSION = 4096;

export async function processImage(
  buffer: Buffer,
  shareId: string,
  payload: WatermarkPayload,
  fingerprint?: Uint8Array
): Promise<void> {
  // .rotate() bakes in EXIF orientation; sharp strips all metadata by default on output
  let pipeline = sharp(buffer).rotate();

  const metadata = await pipeline.metadata();
  if ((metadata.width || 0) > MAX_DIMENSION || (metadata.height || 0) > MAX_DIMENSION) {
    pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true });
  }

  let processed = await pipeline.png().toBuffer();
  processed = await embedDCT(processed, payload);
  processed = await embedLSB(processed, payload);
  // Collusion-secure spread-spectrum fingerprint (green channel): survives JPEG
  // and splicing, so a colluded leak still traces to a recipient.
  if (fingerprint) {
    processed = await embedFingerprintImage(processed, fingerprint, getWatermarkSecret());
  }

  const encrypted = await encryptBuffer(processed, getEncryptionKey());
  const serialized = serializeEncrypted(encrypted);
  await uploadFile(`shares/${shareId}/image.enc`, serialized, 'application/octet-stream');
}
