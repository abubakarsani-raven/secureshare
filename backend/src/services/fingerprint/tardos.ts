import { randomBytes } from 'crypto';

// Symmetric Tardos collusion-secure fingerprinting (Škorić, Katzenbeisser,
// Schaathun, Celik). Each recipient's copy carries a distinct length-m binary
// codeword. When a leaked copy is found, an accusation score is computed per
// recipient; even if several recipients COLLUDE (compare copies and splice a
// mixed/"clean" version), the scheme provably still points at one of the actual
// colluders rather than an innocent, with a tunable error probability.
//
// This is the layer that separates real traitor tracing from a plain
// per-recipient watermark, which collusion trivially defeats.

function randUniform(): number {
  // Uniform in [0,1) from a CSPRNG.
  return randomBytes(4).readUInt32BE(0) / 0x1_0000_0000;
}

/**
 * Recommended code length for `numUsers` recipients, resistant to up to
 * `maxColluders` colluders, with overall false-accusation probability ~epsilon.
 * Symmetric Tardos achieves m ~ pi^2 * c^2 * ln(n/epsilon).
 */
export function recommendedLength(maxColluders: number, numUsers: number, epsilon = 1e-3): number {
  const c = Math.max(2, maxColluders);
  const n = Math.max(2, numUsers);
  return Math.ceil(Math.PI * Math.PI * c * c * Math.log(n / epsilon));
}

/** Suggested accusation threshold: innocent scores are ~N(0, m), so a cutoff at
 *  sqrt(2 m ln(n/epsilon)) bounds the per-codebase false-positive rate by ~epsilon. */
export function accusationThreshold(length: number, numUsers: number, epsilon = 1e-3): number {
  const n = Math.max(2, numUsers);
  return Math.sqrt(2 * length * Math.log(n / epsilon));
}

/**
 * Per-position bias vector p_j, drawn from the arcsine distribution truncated to
 * [t, 1-t] with t = 1/(300c). Shared across every recipient in a campaign and
 * kept secret from recipients.
 */
export function generateBias(length: number, maxColluders = 4): number[] {
  const c = Math.max(2, maxColluders);
  const t = 1 / (300 * c);
  const rMin = Math.asin(Math.sqrt(t)); // truncation point in angle space
  const span = Math.PI / 2 - 2 * rMin;
  const bias = new Array<number>(length);
  for (let j = 0; j < length; j++) {
    const r = rMin + randUniform() * span;
    bias[j] = Math.sin(r) ** 2; // p_j in [t, 1-t], arcsine density
  }
  return bias;
}

/** Draws one recipient's codeword: bit j is 1 with probability p_j. */
export function generateCodeword(bias: number[]): Uint8Array {
  const bits = new Uint8Array(bias.length);
  for (let j = 0; j < bias.length; j++) bits[j] = randUniform() < bias[j] ? 1 : 0;
  return bits;
}

/**
 * Symmetric accusation score of one recipient against the bits extracted from a
 * leaked copy. Each term has mean 0 and variance 1 for an innocent recipient, so
 * innocent totals stay ~N(0, m) while a true (co)leaker's total grows ~m/c.
 * `extracted[j] < 0` marks an erasure (unreadable bit) and is skipped.
 */
export function score(extracted: Int8Array | Uint8Array, codeword: Uint8Array, bias: number[]): number {
  let s = 0;
  for (let j = 0; j < bias.length; j++) {
    const y = extracted[j];
    if (y < 0) continue; // erasure
    const p = bias[j];
    const x = codeword[j];
    const q1 = Math.sqrt((1 - p) / p);
    const q0 = Math.sqrt(p / (1 - p));
    if (y === 1) s += x === 1 ? q1 : -q0;
    else s += x === 1 ? -q1 : q0;
  }
  return s;
}

export interface Accusation {
  index: number;
  score: number;
  accused: boolean;
}

/**
 * Scores every recipient's codeword against the extracted bits and flags those
 * above the threshold, ranked by score (most-implicated first).
 */
export function accuse(
  extracted: Int8Array | Uint8Array,
  codewords: Uint8Array[],
  bias: number[],
  threshold: number
): Accusation[] {
  return codewords
    .map((cw, index) => {
      const s = score(extracted, cw, bias);
      return { index, score: s, accused: s >= threshold };
    })
    .sort((a, b) => b.score - a.score);
}

// --- compact storage helpers (bits <-> base64) ---

export function packBits(bits: Uint8Array): string {
  const bytes = Buffer.alloc(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= 1 << (7 - (i % 8));
  return bytes.toString('base64');
}

export function unpackBits(b64: string, length: number): Uint8Array {
  const bytes = Buffer.from(b64, 'base64');
  const bits = new Uint8Array(length);
  for (let i = 0; i < length; i++) bits[i] = (bytes[i >> 3] >> (7 - (i % 8))) & 1;
  return bits;
}
