import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';
import sharp from 'sharp';
import { getWatermarkSecret } from '../encryption';
import { WatermarkPayload } from './lsbWatermark';

const BLOCK_SIZE = 8;
const ALPHA = 0.15;

function deriveWatermarkKey(): Buffer {
  const secret = getWatermarkSecret();
  return Buffer.from(hkdfSync('sha256', secret, Buffer.from('watermark-dct'), 'aes-256-gcm', 32));
}

function encryptPayloadBits(payload: WatermarkPayload): number[] {
  const key = deriveWatermarkKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const body = Buffer.concat([iv, tag, encrypted]);
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(body.length);
  const full = Buffer.concat([lenBuf, body]);
  const bits: number[] = [];
  for (const byte of full) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }
  return bits;
}

function decryptPayloadBits(bits: number[]): WatermarkPayload | null {
  try {
    if (bits.length < 32) return null;
    const bytes = Buffer.alloc(Math.ceil(bits.length / 8));
    for (let i = 0; i < bits.length; i++) {
      if (bits[i]) bytes[i >> 3] |= 1 << (7 - (i % 8));
    }
    const bodyLength = bytes.readUInt32BE(0);
    if (bodyLength <= 28 || bodyLength > 10000 || bytes.length < 4 + bodyLength) return null;
    const key = deriveWatermarkKey();
    const iv = bytes.slice(4, 16);
    const tag = bytes.slice(16, 32);
    const encrypted = bytes.slice(32, 4 + bodyLength);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    return null;
  }
}

function dct2(block: number[][]): number[][] {
  const N = BLOCK_SIZE;
  const result: number[][] = Array.from({ length: N }, () => Array(N).fill(0));
  for (let u = 0; u < N; u++) {
    for (let v = 0; v < N; v++) {
      let sum = 0;
      for (let x = 0; x < N; x++) {
        for (let y = 0; y < N; y++) {
          sum +=
            block[x][y] *
            Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N)) *
            Math.cos(((2 * y + 1) * v * Math.PI) / (2 * N));
        }
      }
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      result[u][v] = 0.25 * cu * cv * sum;
    }
  }
  return result;
}

function idct2(coeffs: number[][]): number[][] {
  const N = BLOCK_SIZE;
  const result: number[][] = Array.from({ length: N }, () => Array(N).fill(0));
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      let sum = 0;
      for (let u = 0; u < N; u++) {
        for (let v = 0; v < N; v++) {
          const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
          const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
          sum +=
            cu *
            cv *
            coeffs[u][v] *
            Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N)) *
            Math.cos(((2 * y + 1) * v * Math.PI) / (2 * N));
        }
      }
      result[x][y] = 0.25 * sum;
    }
  }
  return result;
}

function extractBlock(yChannel: Float64Array, width: number, bx: number, by: number): number[][] {
  const block: number[][] = Array.from({ length: BLOCK_SIZE }, () => Array(BLOCK_SIZE).fill(0));
  for (let i = 0; i < BLOCK_SIZE; i++) {
    for (let j = 0; j < BLOCK_SIZE; j++) {
      const x = bx * BLOCK_SIZE + j;
      const y = by * BLOCK_SIZE + i;
      if (x < width && y * width + x < yChannel.length) {
        block[i][j] = yChannel[y * width + x];
      }
    }
  }
  return block;
}

function setBlock(yChannel: Float64Array, width: number, bx: number, by: number, block: number[][]): void {
  for (let i = 0; i < BLOCK_SIZE; i++) {
    for (let j = 0; j < BLOCK_SIZE; j++) {
      const x = bx * BLOCK_SIZE + j;
      const y = by * BLOCK_SIZE + i;
      if (x < width) {
        yChannel[y * width + x] = Math.max(0, Math.min(255, block[i][j]));
      }
    }
  }
}

const WATERMARK_CHANNEL = 2; // blue channel — least perceptible to the eye

function readChannel(data: Buffer, info: sharp.OutputInfo): Float64Array {
  const channel = info.channels >= 3 ? WATERMARK_CHANNEL : 0;
  const pixels = new Float64Array(info.width * info.height);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = data[i * info.channels + channel];
  }
  return pixels;
}

function writeChannel(data: Buffer, info: sharp.OutputInfo, pixels: Float64Array): void {
  const channel = info.channels >= 3 ? WATERMARK_CHANNEL : 0;
  for (let i = 0; i < pixels.length; i++) {
    data[i * info.channels + channel] = Math.max(0, Math.min(255, Math.round(pixels[i])));
  }
}

export async function embedDCT(imageBuffer: Buffer, payload: WatermarkPayload): Promise<Buffer> {
  const bits = encryptPayloadBits(payload);
  const { data, info } = await sharp(imageBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = readChannel(data, info);

  const blocksX = Math.floor(info.width / BLOCK_SIZE);
  const blocksY = Math.floor(info.height / BLOCK_SIZE);
  if (blocksX * blocksY < bits.length) {
    throw new Error('Image too small for DCT watermark');
  }
  let bitIdx = 0;

  for (let by = 0; by < blocksY && bitIdx < bits.length; by++) {
    for (let bx = 0; bx < blocksX && bitIdx < bits.length; bx++) {
      const block = extractBlock(pixels, info.width, bx, by);
      const coeffs = dct2(block);
      const bit = bits[bitIdx];
      if (bit === 1) {
        coeffs[4][1] = Math.abs(coeffs[4][1]) + ALPHA * 50;
        coeffs[1][4] = Math.abs(coeffs[1][4]) + ALPHA * 50;
      } else {
        coeffs[4][1] = -Math.abs(coeffs[4][1]) - ALPHA * 50;
        coeffs[1][4] = -Math.abs(coeffs[1][4]) - ALPHA * 50;
      }
      const restored = idct2(coeffs);
      setBlock(pixels, info.width, bx, by, restored);
      bitIdx++;
    }
  }

  const outData = Buffer.from(data);
  writeChannel(outData, info, pixels);
  return sharp(outData, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .png()
    .toBuffer();
}

export async function extractDCT(imageBuffer: Buffer): Promise<WatermarkPayload | null> {
  const { data, info } = await sharp(imageBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = readChannel(data, info);

  const blocksX = Math.floor(info.width / BLOCK_SIZE);
  const blocksY = Math.floor(info.height / BLOCK_SIZE);
  const bits: number[] = [];

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const block = extractBlock(pixels, info.width, bx, by);
      const coeffs = dct2(block);
      const bit = coeffs[4][1] > 0 && coeffs[1][4] > 0 ? 1 : 0;
      bits.push(bit);
    }
  }

  return decryptPayloadBits(bits);
}
