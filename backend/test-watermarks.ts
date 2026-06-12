process.env.WATERMARK_SECRET = 'test-secret-for-roundtrip-check';

import sharp from 'sharp';
import { embedLSB, extractLSB, WatermarkPayload } from './src/services/watermark/lsbWatermark';
import { embedDCT, extractDCT } from './src/services/watermark/dctWatermark';
import { embedPhase, extractPhase } from './src/services/watermark/audioWatermark';

const payload: WatermarkPayload = {
  recipientId: 'abc123def456abcd',
  documentId: '550e8400-e29b-41d4-a716-446655440000',
  sessionId: '0123456789abcdef0123456789abcdef',
  timestamp: 1765000000000,
  email: 'deadbeefdeadbeefdeadbeefdeadbeef',
};

async function makeTestImage(): Promise<Buffer> {
  // photographic-ish gradient + noise so DCT coefficients are non-trivial
  const w = 512, h = 512, ch = 3;
  const raw = Buffer.alloc(w * h * ch);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      raw[i] = (x / 2) & 0xff;
      raw[i + 1] = (y / 2) & 0xff;
      raw[i + 2] = ((x + y) / 4 + ((x * y) % 31)) & 0xff;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: ch } }).png().toBuffer();
}

async function main() {
  let failed = false;

  // LSB
  const img = await makeTestImage();
  const lsbOut = await embedLSB(img, payload);
  const lsbBack = await extractLSB(lsbOut);
  console.log('LSB round-trip:', JSON.stringify(lsbBack) === JSON.stringify(payload) ? 'PASS' : `FAIL ${JSON.stringify(lsbBack)}`);
  if (JSON.stringify(lsbBack) !== JSON.stringify(payload)) failed = true;

  // DCT
  const dctOut = await embedDCT(img, payload);
  const dctBack = await extractDCT(dctOut);
  console.log('DCT round-trip:', JSON.stringify(dctBack) === JSON.stringify(payload) ? 'PASS' : `FAIL ${JSON.stringify(dctBack)}`);
  if (JSON.stringify(dctBack) !== JSON.stringify(payload)) failed = true;

  // DCT + LSB stacked (the image pipeline order)
  const stacked = await embedLSB(dctOut, payload);
  const stackedLsb = await extractLSB(stacked);
  const stackedDct = await extractDCT(stacked);
  console.log('Stacked LSB extract:', JSON.stringify(stackedLsb) === JSON.stringify(payload) ? 'PASS' : 'FAIL');
  console.log('Stacked DCT extract:', JSON.stringify(stackedDct) === JSON.stringify(payload) ? 'PASS' : 'FAIL');
  if (JSON.stringify(stackedLsb) !== JSON.stringify(payload) || JSON.stringify(stackedDct) !== JSON.stringify(payload)) failed = true;

  // Phase coding (audio)
  const samples = new Float64Array(44100);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 44100) + 0.2 * Math.sin((2 * Math.PI * 1330 * i) / 44100);
  }
  const phased = embedPhase(samples, payload);
  const phaseBack = extractPhase(phased);
  console.log('Phase round-trip (float):', JSON.stringify(phaseBack) === JSON.stringify(payload) ? 'PASS' : `FAIL ${JSON.stringify(phaseBack)}`);
  if (JSON.stringify(phaseBack) !== JSON.stringify(payload)) failed = true;

  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
