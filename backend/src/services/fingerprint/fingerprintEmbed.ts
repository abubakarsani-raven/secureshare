import { createHmac } from 'crypto';
import sharp from 'sharp';

// Spread-spectrum embedding of a Tardos codeword into an image. Each codeword
// bit is spread (with a secret PN sign) across many 8x8 DCT blocks and detected
// by correlation. Crucially this degrades GRACEFULLY: JPEG, mild scaling, or a
// colluded splice of two recipients' copies yields a NOISY bit vector rather
// than total loss, which is exactly what the Tardos accusation consumes — so a
// real, possibly-colluded leak still implicates a true recipient.
//
// Uses the green channel only, leaving the blue-channel DCT payload and
// red-channel LSB forensic marks untouched.

const BLOCK = 8;
const STRENGTH = 18; // antipodal coefficient magnitude; trades visibility vs robustness
const COEF_U = 3; // mid-frequency coefficient — survives JPEG, low visibility
const COEF_V = 2;
const CHANNEL = 1; // green

function dct1d(input: number[]): number[] {
  const N = input.length;
  const out = new Array<number>(N).fill(0);
  for (let u = 0; u < N; u++) {
    let sum = 0;
    for (let x = 0; x < N; x++) sum += input[x] * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
    out[u] = sum * (u === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N));
  }
  return out;
}

function idct1d(input: number[]): number[] {
  const N = input.length;
  const out = new Array<number>(N).fill(0);
  for (let x = 0; x < N; x++) {
    let sum = 0;
    for (let u = 0; u < N; u++) {
      const c = u === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N);
      sum += c * input[u] * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
    }
    out[x] = sum;
  }
  return out;
}

function dct2(block: number[][]): number[][] {
  const rows = block.map(dct1d);
  const cols: number[][] = Array.from({ length: BLOCK }, () => new Array<number>(BLOCK));
  for (let c = 0; c < BLOCK; c++) {
    const col = idctColumnForward(rows, c);
    for (let r = 0; r < BLOCK; r++) cols[r][c] = col[r];
  }
  return cols;
}

function idctColumnForward(rows: number[][], c: number): number[] {
  return dct1d(rows.map((r) => r[c]));
}

function idct2(coeffs: number[][]): number[][] {
  const cols: number[][] = Array.from({ length: BLOCK }, () => new Array<number>(BLOCK));
  for (let c = 0; c < BLOCK; c++) {
    const col = idct1d(coeffs.map((r) => r[c]));
    for (let r = 0; r < BLOCK; r++) cols[r][c] = col[r];
  }
  return cols.map(idct1d);
}

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
      const block: number[][] = Array.from({ length: BLOCK }, () => new Array<number>(BLOCK));
      for (let i = 0; i < BLOCK; i++)
        for (let j = 0; j < BLOCK; j++) {
          const x = bx * BLOCK + j;
          const y = by * BLOCK + i;
          block[i][j] = data[(y * info.width + x) * ch + CHANNEL];
        }
      const coeffs = dct2(block);
      const antipodal = codeword[bit] === 1 ? 1 : -1;
      coeffs[COEF_U][COEF_V] = antipodal * chip * STRENGTH;
      const restored = idct2(coeffs);
      for (let i = 0; i < BLOCK; i++)
        for (let j = 0; j < BLOCK; j++) {
          const x = bx * BLOCK + j;
          const y = by * BLOCK + i;
          out[(y * info.width + x) * ch + CHANNEL] = Math.max(0, Math.min(255, Math.round(restored[i][j])));
        }
    }
  }

  return sharp(out, { raw: { width: info.width, height: info.height, channels: ch } }).png().toBuffer();
}

// Returns hard bits (0/1) for each codeword position. Positions whose correlation
// magnitude is below `erasureEps` are marked -1 (erasure) so the Tardos scorer
// can skip unreliable bits rather than guess.
export async function extractFingerprintImage(
  imageBuffer: Buffer,
  length: number,
  secret: string,
  erasureEps = 0
): Promise<Int8Array> {
  const { data, info } = await sharp(imageBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const blocksX = Math.floor(info.width / BLOCK);
  const blocksY = Math.floor(info.height / BLOCK);

  const accum = new Float64Array(length);
  let k = 0;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++, k++) {
      const { bit, chip } = blockKey(secret, k, length);
      const block: number[][] = Array.from({ length: BLOCK }, () => new Array<number>(BLOCK));
      for (let i = 0; i < BLOCK; i++)
        for (let j = 0; j < BLOCK; j++) {
          const x = bx * BLOCK + j;
          const y = by * BLOCK + i;
          block[i][j] = data[(y * info.width + x) * ch + CHANNEL];
        }
      const coeffs = dct2(block);
      accum[bit] += coeffs[COEF_U][COEF_V] * chip; // correlate against the chip
    }
  }

  const bits = new Int8Array(length);
  for (let i = 0; i < length; i++) {
    if (Math.abs(accum[i]) <= erasureEps) bits[i] = -1;
    else bits[i] = accum[i] > 0 ? 1 : 0;
  }
  return bits;
}
