'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetchBlob } from '@/lib/api';
import { secureCanvas } from '@/lib/secureCanvas';
import AntiCapture from '@/components/security/AntiCapture';
import FocusGuard from '@/components/security/FocusGuard';
import DevToolsDetector from '@/components/security/DevToolsDetector';
import GpuWatermark from '@/components/security/GpuWatermark';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  token: string;
  // Provided by the page's single /info fetch — fetching /info here too would
  // consume an extra view and can lock out max_views=1 shares.
  pageCount: number;
  watermark: string;
}

export default function SecureDocViewer({ token, pageCount, watermark }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (pageCount === 0) return;
    setLoading(true);
    apiFetchBlob(`/api/view/${token}/document/${currentPage}`, true)
      .then(async (blob) => {
        const bitmap = await createImageBitmap(blob);
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        secureCanvas(canvas);
        const ctx = canvas.getContext('2d');
        // Draw only — re-embedding an LSB payload here would overwrite the
        // server's encrypted forensic watermark carried in the same bits.
        if (ctx) ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
      })
      .finally(() => setLoading(false));
  }, [token, currentPage, pageCount]);

  return (
    <DevToolsDetector>
      <AntiCapture>
        <FocusGuard>
          <div className="flex flex-col items-center gap-4">
            <div className="relative bg-zinc-100 rounded-lg overflow-hidden min-h-[400px] flex items-center justify-center">
              {loading && <div className="absolute text-zinc-500">Loading page...</div>}
              <canvas ref={canvasRef} className="max-w-full max-h-[70vh]" />
              <GpuWatermark label={watermark} />
            </div>
            {pageCount > 1 && (
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                  disabled={currentPage === 0}
                  className="p-2 rounded-lg bg-zinc-200 disabled:opacity-30"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="text-sm text-zinc-600">
                  Page {currentPage + 1} of {pageCount}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={currentPage >= pageCount - 1}
                  className="p-2 rounded-lg bg-zinc-200 disabled:opacity-30"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </FocusGuard>
      </AntiCapture>
    </DevToolsDetector>
  );
}
