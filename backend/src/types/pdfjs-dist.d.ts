declare module 'pdfjs-dist/legacy/build/pdf.js' {
  export interface RenderTask {
    promise: Promise<void>;
  }

  export interface PDFPageProxy {
    getViewport(params: { scale: number }): { width: number; height: number };
    render(params: {
      canvasContext: unknown;
      viewport: { width: number; height: number };
      canvasFactory?: unknown;
    }): RenderTask;
    cleanup(): void;
  }

  export interface PDFDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PDFPageProxy>;
    destroy(): Promise<void>;
  }

  export interface PDFDocumentLoadingTask {
    promise: Promise<PDFDocumentProxy>;
  }

  export interface CanvasFactory {
    create(width: number, height: number): { canvas: unknown; context: unknown };
    reset(canvasAndContext: { canvas: unknown; context: unknown }, width: number, height: number): void;
    destroy(canvasAndContext: { canvas: unknown; context: unknown }): void;
  }

  export function getDocument(params: Record<string, unknown>): PDFDocumentLoadingTask;
}
