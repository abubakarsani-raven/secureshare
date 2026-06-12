import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';
import { getWatermarkSecret } from '../encryption';
import { WatermarkPayload } from './lsbWatermark';

const FRAME_SIZE = 1024;

function deriveWatermarkKey(): Buffer {
  const secret = getWatermarkSecret();
  return Buffer.from(hkdfSync('sha256', secret, Buffer.from('watermark-audio'), 'aes-256-gcm', 32));
}

function encryptPayload(payload: WatermarkPayload): number[] {
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

function decryptPayload(bits: number[]): WatermarkPayload | null {
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

function fft(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  if (n <= 1) return;

  const evenR = new Float64Array(n / 2);
  const evenI = new Float64Array(n / 2);
  const oddR = new Float64Array(n / 2);
  const oddI = new Float64Array(n / 2);

  for (let i = 0; i < n / 2; i++) {
    evenR[i] = real[i * 2];
    evenI[i] = imag[i * 2];
    oddR[i] = real[i * 2 + 1];
    oddI[i] = imag[i * 2 + 1];
  }

  fft(evenR, evenI);
  fft(oddR, oddI);

  for (let k = 0; k < n / 2; k++) {
    const angle = (-2 * Math.PI * k) / n;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const tR = cos * oddR[k] - sin * oddI[k];
    const tI = sin * oddR[k] + cos * oddI[k];
    real[k] = evenR[k] + tR;
    imag[k] = evenI[k] + tI;
    real[k + n / 2] = evenR[k] - tR;
    imag[k + n / 2] = evenI[k] - tI;
  }
}

function ifft(real: Float64Array, imag: Float64Array): void {
  for (let i = 0; i < imag.length; i++) imag[i] = -imag[i];
  fft(real, imag);
  const n = real.length;
  for (let i = 0; i < n; i++) {
    real[i] /= n;
    imag[i] = -imag[i] / n;
  }
}

function encodePhaseInFrame(samples: Float64Array, bits: number[]): Float64Array {
  const real = new Float64Array(FRAME_SIZE);
  const imag = new Float64Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE && i < samples.length; i++) real[i] = samples[i];

  fft(real, imag);

  const phases = new Float64Array(FRAME_SIZE / 2);
  for (let k = 0; k < FRAME_SIZE / 2; k++) {
    phases[k] = Math.atan2(imag[k], real[k]);
  }

  // Skip bin 0 (DC) — its phase collapses to 0/PI when the time-domain
  // signal is reconstructed as real samples, so it cannot carry a bit.
  for (let i = 0; i < bits.length && i + 1 < phases.length; i++) {
    phases[i + 1] = bits[i] === 1 ? Math.PI / 4 : -Math.PI / 4;
  }

  for (let k = 0; k < FRAME_SIZE / 2; k++) {
    const mag = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
    real[k] = mag * Math.cos(phases[k]);
    imag[k] = mag * Math.sin(phases[k]);
    if (k > 0 && k < FRAME_SIZE / 2) {
      real[FRAME_SIZE - k] = real[k];
      imag[FRAME_SIZE - k] = -imag[k];
    }
  }

  ifft(real, imag);
  const result = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) result[i] = real[i];
  return result;
}

function decodePhaseFromFrame(samples: Float64Array): number[] {
  const real = new Float64Array(FRAME_SIZE);
  const imag = new Float64Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE && i < samples.length; i++) real[i] = samples[i];

  fft(real, imag);
  const bits: number[] = [];
  for (let k = 1; k < FRAME_SIZE / 2; k++) {
    const phase = Math.atan2(imag[k], real[k]);
    bits.push(phase > 0 ? 1 : 0);
  }
  return bits;
}

const BITS_PER_FRAME = FRAME_SIZE / 2 - 1;

export function embedPhase(samples: Float64Array, payload: WatermarkPayload): Float64Array {
  const bits = encryptPayload(payload);
  const framesNeeded = Math.ceil(bits.length / BITS_PER_FRAME);
  if (samples.length < framesNeeded * FRAME_SIZE) {
    throw new Error('Audio too short for phase watermark');
  }

  const result = new Float64Array(samples.length);
  result.set(samples);

  for (let f = 0; f < framesNeeded; f++) {
    const frameBits = bits.slice(f * BITS_PER_FRAME, (f + 1) * BITS_PER_FRAME);
    const start = f * FRAME_SIZE;
    const watermarked = encodePhaseInFrame(samples.slice(start, start + FRAME_SIZE), frameBits);
    result.set(watermarked, start);
  }

  return result;
}

export function extractPhase(samples: Float64Array): WatermarkPayload | null {
  if (samples.length < FRAME_SIZE) return null;

  const bits = decodePhaseFromFrame(samples.slice(0, FRAME_SIZE));
  if (bits.length < 32) return null;

  let bodyLength = 0;
  for (let i = 0; i < 32; i++) bodyLength = (bodyLength << 1) | bits[i];
  if (bodyLength <= 28 || bodyLength > 10000) return null;

  const totalBits = 32 + bodyLength * 8;
  const framesNeeded = Math.ceil(totalBits / BITS_PER_FRAME);
  if (samples.length < framesNeeded * FRAME_SIZE) return null;

  for (let f = 1; f < framesNeeded; f++) {
    const start = f * FRAME_SIZE;
    bits.push(...decodePhaseFromFrame(samples.slice(start, start + FRAME_SIZE)));
  }

  return decryptPayload(bits.slice(0, totalBits));
}

export function floatToInt16(samples: Float64Array): Buffer {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  return buf;
}

export function int16ToFloat(buf: Buffer): Float64Array {
  const samples = new Float64Array(buf.length / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = buf.readInt16LE(i * 2) / 32768;
  }
  return samples;
}
