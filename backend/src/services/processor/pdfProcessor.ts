import { PDFDocument } from 'pdf-lib';
import { embedDCT } from '../watermark/dctWatermark';
import { WatermarkPayload } from '../watermark/lsbWatermark';
import {
  encryptBuffer,
  serializeEncrypted,
  getEncryptionKey,
  getWatermarkSecret,
} from '../encryption';
import { embedFingerprintImage } from '../fingerprint/fingerprintEmbed';
import { uploadFile } from '../storage';
import { renderAllPdfPages } from './pdfJsRenderer';

export async function processPdf(
  buffer: Buffer,
  shareId: string,
  payload: WatermarkPayload,
  fingerprint?: Uint8Array
): Promise<number> {
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  pdfDoc.setTitle('');
  pdfDoc.setAuthor('');
  pdfDoc.setSubject('');
  pdfDoc.setKeywords([]);
  pdfDoc.setProducer('');
  pdfDoc.setCreator('');
  const sanitized = Buffer.from(await pdfDoc.save());

  return renderAllPdfPages(sanitized, async (pageNum, pngBuffer) => {
    let watermarked = await embedDCT(pngBuffer, payload);
    // Each page also carries the collusion-secure spread-spectrum fingerprint,
    // so a leaked page image traces to the recipient even under JPEG/splicing.
    if (fingerprint) {
      watermarked = await embedFingerprintImage(watermarked, fingerprint, getWatermarkSecret());
    }
    const encrypted = await encryptBuffer(watermarked, getEncryptionKey());
    const serialized = serializeEncrypted(encrypted);
    await uploadFile(`shares/${shareId}/pages/${pageNum - 1}.enc`, serialized, 'application/octet-stream');
  });
}
