'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { secureCanvas, drawTextOnCanvas } from '@/lib/secureCanvas';
import { combineKeyFragments, decryptWithCombinedKey } from '@/lib/crypto';
import { useViewSession } from '@/context/ViewSessionContext';
import AntiCapture from '@/components/security/AntiCapture';
import FocusGuard from '@/components/security/FocusGuard';
import DevToolsDetector from '@/components/security/DevToolsDetector';
import GpuWatermark from '@/components/security/GpuWatermark';

interface Props {
  token: string;
  selfDestructSeconds?: number | null;
  watermark: string;
}

export default function SecureMessageViewer({ token, selfDestructSeconds, watermark }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [countdown, setCountdown] = useState(selfDestructSeconds || 0);
  const [destroyed, setDestroyed] = useState(false);
  const { keyFragmentA } = useViewSession();

  useEffect(() => {
    const load = async () => {
      let data: { ciphertext: string; keyFragmentB: string };
      try {
        data = await apiFetch<{ ciphertext: string; keyFragmentB: string }>(
          `/api/view/${token}/message`,
          { viewSession: true }
        );
      } catch (err) {
        // The message may already be gone (self-destructed) or otherwise
        // inaccessible — surface that instead of throwing an unhandled error.
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'destroyed') {
          setDestroyed(true);
        } else {
          drawError('This message is no longer available.');
        }
        return;
      }

      const parsed = JSON.parse(data.ciphertext);
      const hash = typeof window !== 'undefined' ? window.location.hash : '';
      const fragmentC = hash.startsWith('#k=') ? hash.slice(3) : '';

      if (!data.keyFragmentB || !fragmentC) {
        drawError('Missing encryption keys. Ensure you have the complete share link.');
        return;
      }

      // fragmentA is empty when OTP is not required; the server then returns
      // keyFragmentB unmasked, and XOR with '' (zero bytes) is a no-op.
      const combinedKey = combineKeyFragments(keyFragmentA || '', data.keyFragmentB, fragmentC);
      try {
        const plaintext = await decryptWithCombinedKey(parsed.ciphertext, parsed.iv, combinedKey);
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = 800;
          canvas.height = 600;
          secureCanvas(canvas);
          drawTextOnCanvas(canvas, plaintext, { fontSize: 18 });
        }
      } catch {
        drawError('Failed to decrypt message.');
      }
    };
    load();
  }, [token, keyFragmentA]);

  useEffect(() => {
    if (!selfDestructSeconds || selfDestructSeconds <= 0) return;
    setCountdown(selfDestructSeconds);
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(interval);
          handleDestroy();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [selfDestructSeconds]);

  const handleDestroy = async () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
    setDestroyed(true);
    try {
      await apiFetch(`/api/view/${token}/message/destroy`, { method: 'POST', viewSession: true });
    } catch {
      // ignore
    }
  };

  const drawError = (msg: string) => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 800;
      canvas.height = 200;
      secureCanvas(canvas);
      drawTextOnCanvas(canvas, msg, { fontSize: 16, color: '#dc2626' });
    }
  };

  if (destroyed) {
    return (
      <div className="text-center p-12 bg-zinc-100 rounded-xl">
        <p className="text-zinc-600">This message has self-destructed.</p>
      </div>
    );
  }

  return (
    <DevToolsDetector>
      <AntiCapture>
        <FocusGuard>
          <div className="relative">
            {countdown > 0 && (
              <div className="absolute top-4 right-4 bg-red-500 text-white px-3 py-1 rounded-full text-sm font-mono z-10">
                {countdown}s
              </div>
            )}
            <canvas ref={canvasRef} className="w-full border rounded-xl bg-white" />
            <GpuWatermark label={watermark} />
          </div>
        </FocusGuard>
      </AntiCapture>
    </DevToolsDetector>
  );
}
