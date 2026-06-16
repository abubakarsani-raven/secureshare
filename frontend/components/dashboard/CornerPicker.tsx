'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface Point {
  x: number;
  y: number;
}

// Lets the investigator mark the four screen corners on an angled phone-photo so
// the backend can perspective-correct it before extraction. Handles are tracked
// as fractions of the image (resolution-independent); corners are reported back
// in the image's NATURAL pixel coordinates, which is what the dewarp expects.
const DEFAULT_FRACTIONS: Point[] = [
  { x: 0.15, y: 0.15 }, // top-left
  { x: 0.85, y: 0.15 }, // top-right
  { x: 0.85, y: 0.85 }, // bottom-right
  { x: 0.15, y: 0.85 }, // bottom-left
];

export default function CornerPicker({
  file,
  onCorners,
}: {
  file: File;
  onCorners: (corners: Point[] | null) => void;
}) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const containerRef = useRef<HTMLDivElement>(null);
  const natural = useRef<{ w: number; h: number } | null>(null);
  const [fractions, setFractions] = useState<Point[]>(DEFAULT_FRACTIONS);
  const [dragging, setDragging] = useState<number | null>(null);

  // Report corners in natural pixels whenever handles move (once we know size).
  useEffect(() => {
    const n = natural.current;
    if (!n) return;
    onCorners(fractions.map((f) => ({ x: f.x * n.w, y: f.y * n.h })));
  }, [fractions, onCorners]);

  const moveHandle = (clientX: number, clientY: number) => {
    if (dragging === null) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    setFractions((prev) => prev.map((p, i) => (i === dragging ? { x, y } : p)));
  };

  useEffect(() => {
    if (dragging === null) return;
    const onMove = (e: PointerEvent) => moveHandle(e.clientX, e.clientY);
    const onUp = () => setDragging(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging]);

  const labels = ['TL', 'TR', 'BR', 'BL'];

  return (
    <div className="space-y-2">
      <p className="text-xs text-blue-800 dark:text-blue-300">
        Drag the four dots to the corners of the <strong>screen</strong> in the photo, then Extract.
      </p>
      <div
        ref={containerRef}
        className="relative inline-block select-none touch-none max-w-full"
        style={{ lineHeight: 0 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Leaked photo"
          className="max-w-full max-h-[420px] rounded border"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            natural.current = { w: img.naturalWidth, h: img.naturalHeight };
            // Trigger an initial report now that the size is known.
            setFractions((f) => [...f]);
          }}
        />
        {/* Quad outline */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 1 1">
          <polygon
            points={fractions.map((f) => `${f.x},${f.y}`).join(' ')}
            fill="rgba(59,130,246,0.12)"
            stroke="rgb(59,130,246)"
            strokeWidth={0.004}
          />
        </svg>
        {fractions.map((f, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Corner ${labels[i]}`}
            onPointerDown={(e) => {
              e.preventDefault();
              setDragging(i);
            }}
            className="absolute z-10 w-6 h-6 -ml-3 -mt-3 rounded-full bg-blue-600 border-2 border-white shadow cursor-grab active:cursor-grabbing flex items-center justify-center text-[9px] font-bold text-white"
            style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, touchAction: 'none' }}
          >
            {labels[i]}
          </button>
        ))}
      </div>
    </div>
  );
}
