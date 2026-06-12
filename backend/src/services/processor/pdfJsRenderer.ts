import { createCanvas, Canvas, SKRSContext2D, DOMMatrix, Path2D, ImageData } from '@napi-rs/canvas';
import sharp from 'sharp';
import type { PDFDocumentProxy, CanvasFactory } from 'pdfjs-dist/legacy/build/pdf.js';

// pdf.js expects these browser globals; without them it tries to require the
// optional 'canvas' package, warns, and may render geometry/images incorrectly.
const g = globalThis as Record<string, unknown>;
g.DOMMatrix ??= DOMMatrix;
g.Path2D ??= Path2D;
g.ImageData ??= ImageData;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js') as typeof import('pdfjs-dist/legacy/build/pdf.js');

const MAX_WIDTH = 1200;

class NodeCanvasFactory implements CanvasFactory {
  create(width: number, height: number): { canvas: Canvas; context: SKRSContext2D } {
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
    const context = canvas.getContext('2d');
    return { canvas, context };
  }

  reset(
    canvasAndContext: { canvas: Canvas; context: SKRSContext2D },
    width: number,
    height: number
  ): void {
    canvasAndContext.canvas.width = Math.ceil(width);
    canvasAndContext.canvas.height = Math.ceil(height);
  }

  destroy(canvasAndContext: { canvas: Canvas; context: SKRSContext2D }): void {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

function getRenderScale(): number {
  const raw = process.env.PDF_RENDER_SCALE;
  const scale = raw ? parseFloat(raw) : 1.5;
  return Number.isFinite(scale) && scale > 0 ? scale : 1.5;
}

async function loadPdf(buffer: Buffer): Promise<PDFDocumentProxy> {
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({
    data,
    disableFontFace: false,
    useSystemFonts: true,
    standardFontDataUrl: undefined,
    useWorkerFetch: false,
    isEvalSupported: false,
  });
  return loadingTask.promise;
}

async function renderPageInternal(
  pdf: PDFDocumentProxy,
  pageNum: number,
  scale: number
): Promise<Buffer> {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvasFactory = new NodeCanvasFactory();
  const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);

  try {
    await page.render({
      canvasContext: canvasAndContext.context,
      viewport,
      canvasFactory,
    }).promise;

    let pngBuffer = canvasAndContext.canvas.toBuffer('image/png');

    const metadata = await sharp(pngBuffer).metadata();
    if ((metadata.width || 0) > MAX_WIDTH) {
      pngBuffer = await sharp(pngBuffer)
        .resize(MAX_WIDTH, MAX_WIDTH, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
    }

    return pngBuffer;
  } finally {
    canvasFactory.destroy(canvasAndContext);
    page.cleanup();
  }
}

export async function getPdfPageCount(buffer: Buffer): Promise<number> {
  const pdf = await loadPdf(buffer);
  try {
    return pdf.numPages;
  } finally {
    await pdf.destroy();
  }
}

export async function renderPdfPageToPng(
  buffer: Buffer,
  pageNum: number,
  scale?: number
): Promise<Buffer> {
  const renderScale = scale ?? getRenderScale();
  const pdf = await loadPdf(buffer);
  try {
    return await renderPageInternal(pdf, pageNum, renderScale);
  } finally {
    await pdf.destroy();
  }
}

/** Load PDF once and render all pages — used by pdfProcessor for efficiency. */
export async function renderAllPdfPages(
  buffer: Buffer,
  onPage: (pageNum: number, png: Buffer) => Promise<void>,
  scale?: number
): Promise<number> {
  const renderScale = scale ?? getRenderScale();
  const pdf = await loadPdf(buffer);
  try {
    const pageCount = pdf.numPages;
    for (let i = 1; i <= pageCount; i++) {
      const png = await renderPageInternal(pdf, i, renderScale);
      await onPage(i, png);
    }
    return pageCount;
  } finally {
    await pdf.destroy();
  }
}
