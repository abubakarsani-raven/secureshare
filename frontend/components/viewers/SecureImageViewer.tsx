'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetchBlob } from '@/lib/api';
import { secureCanvas } from '@/lib/secureCanvas';
import { embedOnCanvas } from '@/components/watermark/LSBEmbedder';
import AntiCapture from '@/components/security/AntiCapture';
import FocusGuard from '@/components/security/FocusGuard';
import DevToolsDetector from '@/components/security/DevToolsDetector';

interface Props {
  token: string;
}

export default function SecureImageViewer({ token }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetchBlob(`/api/view/${token}/image`, true)
      .then(async (blob) => {
        const bitmap = await createImageBitmap(blob);
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        secureCanvas(canvas);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0);
          embedOnCanvas(canvas, { sessionId: crypto.randomUUID(), timestamp: Date.now() });
        }
        bitmap.close();
      })
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <DevToolsDetector>
      <AntiCapture>
        <FocusGuard>
          <div className="flex justify-center bg-zinc-100 rounded-lg min-h-[400px] items-center">
            {loading && <div className="absolute text-zinc-500">Loading image...</div>}
            <canvas ref={canvasRef} className="max-w-full max-h-[70vh]" />
          </div>
        </FocusGuard>
      </AntiCapture>
    </DevToolsDetector>
  );
}
