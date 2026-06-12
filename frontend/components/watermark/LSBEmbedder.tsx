'use client';

export function embedOnCanvas(canvas: HTMLCanvasElement, payload: object): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  const json = JSON.stringify(payload);
  const binary = Array.from(new TextEncoder().encode(json))
    .map((byte) => byte.toString(2).padStart(8, '0'))
    .join('');
  const lengthBits = json.length.toString(2).padStart(32, '0');
  const allBits = lengthBits + binary;

  let bitIndex = 0;
  for (let i = 0; i < pixels.length && bitIndex < allBits.length; i += 4) {
    pixels[i] = (pixels[i] & 0xfe) | parseInt(allBits[bitIndex], 10);
    bitIndex++;
  }

  ctx.putImageData(imageData, 0, 0);
}
