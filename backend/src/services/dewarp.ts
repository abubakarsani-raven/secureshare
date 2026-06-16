import sharp from 'sharp';

export interface Point {
  x: number;
  y: number;
}

// Solves the 8 homography coefficients (h33 fixed to 1) mapping the four
// destination-rectangle corners to the four source-quad corners, via the
// standard DLT 8x8 linear system. Returns [a,b,c,d,e,f,g,h] for:
//   srcX = (a*x + b*y + c) / (g*x + h*y + 1)
//   srcY = (d*x + e*y + f) / (g*x + h*y + 1)
function solveHomography(dst: Point[], src: Point[]): number[] {
  // Build A (8x8) and B (8) from the 4 correspondences.
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = dst[i];
    const { x: u, y: v } = src[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    B.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    B.push(v);
  }
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    }
    [A[col], A[pivot]] = [A[pivot], A[col]];
    [B[col], B[pivot]] = [B[pivot], B[col]];
    const div = A[col][col] || 1e-9;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const factor = A[r][col] / div;
      for (let c = col; c < 8; c++) A[r][c] -= factor * A[col][c];
      B[r] -= factor * B[col];
    }
  }
  return A.map((row, i) => B[i] / (row[i] || 1e-9));
}

// Perspective-corrects a photographed screen: given the four corners of the
// screen region in the source photo (top-left, top-right, bottom-right,
// bottom-left), warps that quad to a frontal rectangle so the existing reveal/
// extract pipeline — which assumes a fronto-parallel capture — can read the
// watermark. Inverse-maps each output pixel and samples the source bilinearly.
export async function dewarpPerspective(
  buffer: Buffer,
  corners: Point[],
  outWidth = 1200,
  outHeight = 800
): Promise<Buffer> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sw = info.width;
  const sh = info.height;
  const ch = info.channels;

  const dstRect: Point[] = [
    { x: 0, y: 0 },
    { x: outWidth - 1, y: 0 },
    { x: outWidth - 1, y: outHeight - 1 },
    { x: 0, y: outHeight - 1 },
  ];
  const h = solveHomography(dstRect, corners);
  const [a, b, c, d, e, f, g, hh] = h;

  const out = Buffer.alloc(outWidth * outHeight * ch);
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const w = g * x + hh * y + 1;
      const sx = (a * x + b * y + c) / w;
      const sy = (d * x + e * y + f) / w;
      const oi = (y * outWidth + x) * ch;
      if (sx < 0 || sx >= sw - 1 || sy < 0 || sy >= sh - 1) {
        // Outside the source -> white (matches the reveal's background colour).
        for (let k = 0; k < ch; k++) out[oi + k] = 255;
        continue;
      }
      // Bilinear sample.
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let k = 0; k < ch; k++) {
        const p00 = data[(y0 * sw + x0) * ch + k];
        const p10 = data[(y0 * sw + x0 + 1) * ch + k];
        const p01 = data[((y0 + 1) * sw + x0) * ch + k];
        const p11 = data[((y0 + 1) * sw + x0 + 1) * ch + k];
        const top = p00 + (p10 - p00) * fx;
        const bot = p01 + (p11 - p01) * fx;
        out[oi + k] = Math.round(top + (bot - top) * fy);
      }
    }
  }
  return sharp(out, { raw: { width: outWidth, height: outHeight, channels: ch } }).png().toBuffer();
}
