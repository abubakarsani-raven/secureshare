'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetchBlob } from '@/lib/api';
import { secureCanvas } from '@/lib/secureCanvas';
import AntiCapture from '@/components/security/AntiCapture';
import FocusGuard from '@/components/security/FocusGuard';
import DevToolsDetector from '@/components/security/DevToolsDetector';
import { Play, Pause } from 'lucide-react';

interface Props {
  token: string;
  // Provided by the page's single /info fetch — fetching /info here too would
  // consume an extra view and can lock out max_views=1 shares.
  chunkCount: number;
}

// Concatenates the decoded 30s chunks into one continuous buffer so playback
// covers the whole track, not just the first chunk.
function mergeBuffers(ctx: AudioContext, buffers: AudioBuffer[]): AudioBuffer | null {
  if (buffers.length === 0) return null;
  if (buffers.length === 1) return buffers[0];

  const channels = Math.max(...buffers.map((b) => b.numberOfChannels));
  const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
  const merged = ctx.createBuffer(channels, totalLength, buffers[0].sampleRate);

  let offset = 0;
  for (const buffer of buffers) {
    for (let ch = 0; ch < channels; ch++) {
      const source = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
      merged.getChannelData(ch).set(source, offset);
    }
    offset += buffer.length;
  }
  return merged;
}

export default function SecureAudioPlayer({ token, chunkCount }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const mergedRef = useRef<AudioBuffer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (chunkCount === 0) return;
    let cancelled = false;

    const load = async () => {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const buffers: AudioBuffer[] = [];
      for (let i = 0; i < chunkCount; i++) {
        const blob = await apiFetchBlob(`/api/view/${token}/audio/chunk/${i}`, true);
        const arrayBuffer = await blob.arrayBuffer();
        try {
          const decoded = await ctx.decodeAudioData(arrayBuffer);
          buffers.push(decoded);
        } catch {
          // skip undecodable chunks
        }
      }
      if (cancelled) return;
      mergedRef.current = mergeBuffers(ctx, buffers);
      drawWaveform(mergedRef.current);
      setLoading(false);
    };
    load().catch(console.error);

    return () => {
      cancelled = true;
      sourceRef.current?.stop();
      audioCtxRef.current?.close();
    };
  }, [token, chunkCount]);

  const drawWaveform = (buffer: AudioBuffer | null) => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer) return;
    secureCanvas(canvas);
    canvas.width = 800;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / canvas.width);
    const amp = canvas.height / 2;

    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < canvas.width; i++) {
      let min = 0;
      let max = 0;
      for (let j = 0; j < step; j++) {
        const v = data[i * step + j] || 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      ctx.moveTo(i, (1 + min) * amp);
      ctx.lineTo(i, (1 + max) * amp);
    }
    ctx.stroke();
  };

  const togglePlay = async () => {
    const ctx = audioCtxRef.current;
    if (!ctx || !mergedRef.current) return;

    if (playing) {
      sourceRef.current?.stop();
      setPlaying(false);
      return;
    }

    sourceRef.current?.stop();
    const source = ctx.createBufferSource();
    source.buffer = mergedRef.current;
    source.connect(ctx.destination);
    source.onended = () => setPlaying(false);
    source.start();
    sourceRef.current = source;
    setPlaying(true);
  };

  return (
    <DevToolsDetector>
      <AntiCapture token={token}>
        <FocusGuard>
          <div className="bg-zinc-900 rounded-xl p-6">
            {loading && <div className="text-zinc-400 mb-4">Loading audio...</div>}
            <canvas ref={canvasRef} className="w-full rounded-lg mb-4" />
            <div className="flex items-center gap-4">
              <button
                onClick={togglePlay}
                disabled={loading || chunkCount === 0}
                className="p-3 bg-primary text-white rounded-full disabled:opacity-50"
              >
                {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
              </button>
              <span className="text-zinc-400 text-sm">
                {chunkCount} chunk{chunkCount === 1 ? '' : 's'} loaded
              </span>
            </div>
          </div>
        </FocusGuard>
      </AntiCapture>
    </DevToolsDetector>
  );
}
