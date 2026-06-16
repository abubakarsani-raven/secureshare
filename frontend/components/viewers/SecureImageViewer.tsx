'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetchBlob } from '@/lib/api';
import { secureCanvas } from '@/lib/secureCanvas';
import AntiCapture from '@/components/security/AntiCapture';
import FocusGuard from '@/components/security/FocusGuard';
import DevToolsDetector from '@/components/security/DevToolsDetector';
import GpuWatermark from '@/components/security/GpuWatermark';

interface Props {
  token: string;
  watermark: string;
}

export default function SecureImageViewer({ token, watermark }: Props) {
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
        // Draw only — re-embedding an LSB payload here would overwrite the
        // server's encrypted forensic watermark carried in the same bits.
        if (ctx) ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
      })
      .catch(() => {
        // Share may have been revoked/expired mid-view — fail quietly.
      })
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <DevToolsDetector>
      <AntiCapture token={token}>
        <FocusGuard>
          <div className="relative flex justify-center bg-zinc-100 rounded-lg min-h-[400px] items-center">
            {loading && <div className="absolute text-zinc-500">Loading image...</div>}
            <canvas ref={canvasRef} className="max-w-full max-h-[70vh]" />
            <GpuWatermark label={watermark} />
          </div>
        </FocusGuard>
      </AntiCapture>
    </DevToolsDetector>
  );
}
