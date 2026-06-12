export function secureCanvas(canvas: HTMLCanvasElement): void {
  canvas.toDataURL = () => 'blocked';
  canvas.toBlob = (_callback, _type, _quality) => null;
}

export function drawTextOnCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  options?: { fontSize?: number; color?: string; lineHeight?: number }
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const fontSize = options?.fontSize || 16;
  const lineHeight = options?.lineHeight || fontSize * 1.5;
  const color = options?.color || '#18181b';
  const padding = 24;
  const maxWidth = canvas.width - padding * 2;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;

  const words = text.split(/\s+/);
  let line = '';
  let y = padding + fontSize;

  for (const word of words) {
    const testLine = line + word + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && line) {
      ctx.fillText(line.trim(), padding, y);
      line = word + ' ';
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line.trim()) ctx.fillText(line.trim(), padding, y);
}
