import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';
import sharp from 'sharp';
import { getWatermarkSecret } from '../encryption';

export interface WatermarkPayload {
  recipientId: string;
  documentId: string;
  sessionId: string;
  timestamp: number;
  email: string;
}

function deriveWatermarkKey(): Buffer {
  const secret = getWatermarkSecret();
  return Buffer.from(hkdfSync('sha256', secret, Buffer.from('watermark-lsb'), 'aes-256-gcm', 32));
}

function encryptPayload(payload: WatermarkPayload): Buffer {
  const key = deriveWatermarkKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

function decryptPayload(data: Buffer): WatermarkPayload | null {
  try {
    const key = deriveWatermarkKey();
    const iv = data.slice(0, 12);
    const tag = data.slice(12, 28);
    const encrypted = data.slice(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    return null;
  }
}

function bytesToBits(bytes: Buffer): number[] {
  const bits: number[] = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) {
      bits.push((byte >> i) & 1);
    }
  }
  return bits;
}

function bitsToBytes(bits: number[]): Buffer {
  const bytes = Buffer.alloc(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) bytes[i >> 3] |= 1 << (7 - (i % 8));
  }
  return bytes;
}

export async function embedLSB(imageBuffer: Buffer, payload: WatermarkPayload): Promise<Buffer> {
  const encrypted = encryptPayload(payload);
  const lengthBits = bytesToBits(Buffer.alloc(4));
  lengthBits.length = 0;
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(encrypted.length);
  const allBits = [...bytesToBits(lenBuf), ...bytesToBits(encrypted)];

  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = Buffer.from(data);
  const channels = info.channels;
  let bitIndex = 0;

  for (let i = 0; i < pixels.length && bitIndex < allBits.length; i += channels) {
    pixels[i] = (pixels[i] & 0xfe) | allBits[bitIndex];
    bitIndex++;
  }

  if (bitIndex < allBits.length) {
    throw new Error('Image too small for LSB watermark');
  }

  return sharp(pixels, { raw: { width: info.width, height: info.height, channels } })
    .png()
    .toBuffer();
}

export async function extractLSB(imageBuffer: Buffer): Promise<WatermarkPayload | null> {
  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = data;
  const channels = info.channels;
  const bits: number[] = [];

  for (let i = 0; i < pixels.length; i += channels) {
    bits.push(pixels[i] & 1);
  }

  if (bits.length < 32) return null;
  const lengthBytes = bitsToBytes(bits.slice(0, 32));
  const length = lengthBytes.readUInt32BE(0);
  if (length <= 0 || length > 10000) return null;

  const totalBits = 32 + length * 8;
  if (bits.length < totalBits) return null;

  const payloadBytes = bitsToBytes(bits.slice(32, totalBits));
  return decryptPayload(payloadBytes);
}
