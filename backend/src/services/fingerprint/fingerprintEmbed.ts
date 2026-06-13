import { createHmac } from 'crypto';
import sharp from 'sharp';

// Spread-spectrum embedding of a Tardos codeword into an image. Each codeword
// bit is spread (with a secret PN sign) across many 8x8 blocks and detected by
// correlation against one mid-frequency DCT basis vector. This degrades
// GRACEFULLY: JPEG, mild scaling, or a colluded splice of two recipients' copies
// yields a NOISY bit vector rather than total loss — exactly what the Tardos
// accusation consumes — so a real, possibly-colluded leak still implicates a
// true recipient.
//
// Only the green channel is touched, leaving the blue-channel DCT payload and
// red-channel LSB forensic marks intact. Rather than a full 8x8 DCT per block we
// project onto a single precomputed orthonormal basis vector for the target
// coefficient, which is ~16x faster and keeps multi-page documents feasible.

const BLOCK = 8;
const STRENGTH = 18; // antipodal coefficient magnitude; visibility vs robustness
const COEF_U: number = 3; // mid-frequency coefficient (row/vertical) — survives JPEG
const COEF_V: number = 2; // (col/horizontal)
const CHANNEL = 1; // green

// Orthonormal 2D DCT basis for the (COEF_U, COEF_V) coefficient. <BASIS,BASIS>=1,
// so the coefficient is sum(pixel*BASIS) and setting it is a single projection.
const BASIS: number[][] = (() => {
  const cu = COEF_U === 0 ? Math.sqrt(1 / BLOCK) : Math.sqrt(2 / BLOCK);
  const cv = COEF_V === 0 ? Math.sqrt(1 / BLOCK) : Math.sqrt(2 / BLOCK);
  const b: number[][] = [];
  for (let i = 0; i < BLOCK; i++) {
    b[i] = [];
    for (let j = 0; j < BLOCK; j++) {
      b[i][j] =
        cu * cv * Math.cos(((2 * i + 1) * COEF_U * Math.PI) / 16) * Math.cos(((2 * j + 1) * COEF_V * Math.PI) / 16);
    }
  }
  return b;
})();

// Deterministic per-block assignment: which codeword bit a block carries and the
// secret +/-1 chip applied to it (spreads/whitens the pattern).
function blockKey(secret: string, k: number, totalBits: number): { bit: number; chip: number } {
  const h = createHmac('sha256', secret).update(`fp-block-${k}`).digest();
  const idx = h.readUInt32BE(0) % totalBits;
  const chip = (h[4] & 1) === 1 ? 1 : -1;
  return { bit: idx, chip };
}

export async function embedFingerprintImage(
  imageBuffer: Buffer,
  codeword: Uint8Array,
  secret: string
): Promise<Buffer> {
  const { data, info } = await sharp(imageBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const blocksX = Math.floor(info.width / BLOCK);
  const blocksY = Math.floor(info.height / BLOCK);
  const total = codeword.length;
  const out = Buffer.from(data);

  let k = 0;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++, k++) {
      const { bit, chip } = blockKey(secret, k, total);
      // current coefficient = projection of the block onto the basis
      let cur = 0;
      for (let i = 0; i < BLOCK; i++) {
        const row = (by * BLOCK + i) * info.width;
        for (let j = 0; j < BLOCK; j++) {
          cur += data[(row + bx * BLOCK + j) * ch + CHANNEL] * BASIS[i][j];
        }
      }
      const target = (codeword[bit] === 1 ? 1 : -1) * chip * STRENGTH;
      const delta = target - cur;
      // adding delta*BASIS sets only this coefficient (orthonormal basis)
      for (let i = 0; i < BLOCK; i++) {
        const row = (by * BLOCK + i) * info.width;
        for (let j = 0; j < BLOCK; j++) {
          const idx = (row + bx * BLOCK + j) * ch + CHANNEL;
          out[idx] = Math.max(0, Math.min(255, Math.round(data[idx] + delta * BASIS[i][j])));
        }
      }
    }
  }

  return sharp(out, { raw: { width: info.width, height: info.height, channels: ch } }).png().toBuffer();
}

// Correlates the green-channel blocks against the chip sequence, with the block
// grid started at pixel origin (ox, oy). Returns the per-bit accumulator.
function correlate(
  data: Buffer,
  width: number,
  height: number,
  ch: number,
  length: number,
  secret: string,
  ox: number,
  oy: number
): Float64Array {
  const blocksX = Math.floor((width - ox) / BLOCK);
  const blocksY = Math.floor((height - oy) / BLOCK);
  const accum = new Float64Array(length);
  let k = 0;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++, k++) {
      const { bit, chip } = blockKey(secret, k, length);
      let coef = 0;
      for (let i = 0; i < BLOCK; i++) {
        const row = (by * BLOCK + oy + i) * width;
        for (let j = 0; j < BLOCK; j++) {
          coef += data[(row + bx * BLOCK + ox + j) * ch + CHANNEL] * BASIS[i][j];
        }
      }
      accum[bit] += coef * chip;
    }
  }
  return accum;
}

function bitsFromAccum(accum: Float64Array, length: number, erasureEps: number): Int8Array {
  const bits = new Int8Array(length);
  for (let i = 0; i < length; i++) {
    if (Math.abs(accum[i]) <= erasureEps) bits[i] = -1;
    else bits[i] = accum[i] > 0 ? 1 : 0;
  }
  return bits;
}

// Returns hard bits (0/1) per codeword position. Positions whose correlation
// magnitude is below `erasureEps` are marked -1 (erasure) so the Tardos scorer
// can skip unreliable bits rather than guess. Assumes the leak is at the
// embedding resolution (use the robust variant for screenshots/rescales).
export async function extractFingerprintImage(
  imageBuffer: Buffer,
  length: number,
  secret: string,
  erasureEps = 0
): Promise<Int8Array> {
  const { data, info } = await sharp(imageBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const accum = correlate(data, info.width, info.height, info.channels, length, secret, 0, 0);
  return bitsFromAccum(accum, length, erasureEps);
}

// Resynchronizing extraction for leaks that were rescaled (e.g. a screenshot at
// a different resolution): resize back to the embedding grid so the 8x8 blocks
// re-align, then search a few sub-block grid offsets and keep the strongest
// correlation. Recovers from uniform rescaling, mild crop, blur and noise. Does
// NOT correct perspective or rotation — a phone photo of a screen at an angle,
// or a print-then-scan, still needs a registration/DNN front-end.
export async function extractFingerprintImageRobust(
  imageBuffer: Buffer,
  length: number,
  secret: string,
  embedWidth: number,
  embedHeight: number,
  erasureEps = 0
): Promise<Int8Array> {
  // Force the leak back onto the original pixel grid.
  const { data, info } = await sharp(imageBuffer)
    .removeAlpha()
    .resize(embedWidth, embedHeight, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let best: Float64Array | null = null;
  let bestEnergy = -1;
  for (const oy of [0, 2, 4, 6]) {
    for (const ox of [0, 2, 4, 6]) {
      const accum = correlate(data, info.width, info.height, info.channels, length, secret, ox, oy);
      let energy = 0;
      for (let i = 0; i < length; i++) energy += Math.abs(accum[i]);
      if (energy > bestEnergy) {
        bestEnergy = energy;
        best = accum;
      }
    }
  }
  return bitsFromAccum(best as Float64Array, length, erasureEps);
}
