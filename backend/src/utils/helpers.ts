import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'crypto';
import { sha3_512 } from 'js-sha3';

const MAGIC: Record<string, number[][]> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]],
  jpeg: [[0xff, 0xd8, 0xff]],
  png: [[0x89, 0x50, 0x4e, 0x47]],
  webp: [[0x52, 0x49, 0x46, 0x46]],
  gif: [[0x47, 0x49, 0x46, 0x38]],
  mp4: [[0x00, 0x00, 0x00]],
  mov: [[0x00, 0x00, 0x00]],
  webm: [[0x1a, 0x45, 0xdf, 0xa3]],
  mp3: [[0x49, 0x44, 0x33], [0xff, 0xfb], [0xff, 0xf3], [0xff, 0xf2]],
  wav: [[0x52, 0x49, 0x46, 0x46]],
  m4a: [[0x00, 0x00, 0x00]],
  ogg: [[0x4f, 0x67, 0x67, 0x53]],
};

function matchesMagic(buffer: Buffer, patterns: number[][]): boolean {
  for (const pattern of patterns) {
    // The all-zero sentinel pattern means "ISO BMFF": require 'ftyp' at offset 4,
    // never fall through to a prefix match (any file starting with 00 00 00 would pass).
    if (pattern.length === 3 && pattern.every((b) => b === 0)) {
      if (
        buffer.length >= 8 &&
        buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70
      ) {
        return true;
      }
      continue;
    }
    let match = true;
    for (let i = 0; i < pattern.length; i++) {
      if (buffer[i] !== pattern[i]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

export function validateMagicBytes(buffer: Buffer, type: string): boolean {
  const patterns = MAGIC[type];
  if (!patterns) return false;
  if (type === 'webp' && buffer.length >= 12) {
    return buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[8] === 0x57 && buffer[9] === 0x45;
  }
  if (type === 'wav' && buffer.length >= 12) {
    return buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[8] === 0x57 && buffer[9] === 0x41;
  }
  return matchesMagic(buffer, patterns);
}

export function hashEmail(email: string): string {
  return sha3_512(email.toLowerCase().trim());
}

export function emailHint(email: string): string {
  const [local, domain] = email.toLowerCase().trim().split('@');
  if (!local || !domain) return '***@***';
  const hint = local.length <= 2 ? local[0] + '***' : local[0] + '***' + local[local.length - 1];
  return `${hint}@${domain}`;
}

export function tokenLookup(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

export function generateWatermarkSeed(): string {
  return randomBytes(16).toString('hex');
}

export function deriveKeyFragment(input: string, purpose: string, secret: string): string {
  const derived = hkdfSync('sha256', secret, input, purpose, 32);
  return Buffer.from(derived).toString('base64url');
}

export function xorBase64Fragments(fragmentB: string, fragmentA: string): string {
  if (!fragmentA) return fragmentB;
  const normalize = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/');
  const b = Buffer.from(normalize(fragmentB), 'base64');
  const a = Buffer.from(normalize(fragmentA), 'base64');
  const out = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) {
    out[i] = (b[i] || 0) ^ (a[i] || 0);
  }
  return out.toString('base64');
}

export function hmacToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

export function safeCompare(a: string, b: string): boolean {
  const bufA = createHash('sha256').update(a).digest();
  const bufB = createHash('sha256').update(b).digest();
  return timingSafeEqual(bufA, bufB);
}

export function parseUserAgent(ua: string): { device: string; browser: string; os: string } {
  let browser = 'Unknown';
  let os = 'Unknown';
  let device = 'Desktop';

  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS/i.test(ua)) os = 'macOS';
  else if (/Android/i.test(ua)) { os = 'Android'; device = 'Mobile'; }
  else if (/iPhone|iPad/i.test(ua)) { os = 'iOS'; device = /iPad/i.test(ua) ? 'Tablet' : 'Mobile'; }
  else if (/Linux/i.test(ua)) os = 'Linux';

  return { device, browser, os };
}
