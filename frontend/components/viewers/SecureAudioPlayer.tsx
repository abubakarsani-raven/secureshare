'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch, apiFetchBlob } from '@/lib/api';
import { secureCanvas } from '@/lib/secureCanvas';
import AntiCapture from '@/components/security/AntiCapture';
import FocusGuard from '@/components/security/FocusGuard';
import DevToolsDetector from '@/components/security/DevToolsDetector';
import { Play, Pause } from 'lucide-react';

interface Props {
  token: string;
}

export default function SecureAudioPlayer({ token }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chunkCount, setChunkCount] = useState(0);
  const buffersRef = useRef<AudioBuffer[]>([]);

  useEffect(() => {
    apiFetch<{ chunkCount: number }>(`/api/view/${token}/info`, { viewSession: true })
      .then(async (info) => {
        setChunkCount(info.chunkCount || 0);
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const buffers: AudioBuffer[] = [];
        for (let i = 0; i < (info.chunkCount || 0); i++) {
          const blob = await apiFetchBlob(`/api/view/${token}/audio/chunk/${i}`, true);
          const arrayBuffer = await blob.arrayBuffer();
          try {
            const decoded = await ctx.decodeAudioData(arrayBuffer);
            buffers.push(decoded);
          } catch {
            // skip undecodable chunks
          }
        }
        buffersRef.current = buffers;
        drawWaveform(buffers);
        setLoading(false);
      })
      .catch(console.error);

    return () => {
      sourceRef.current?.stop();
      audioCtxRef.current?.close();
    };
  }, [token]);

  const drawWaveform = (buffers: AudioBuffer[]) => {
    const canvas = canvasRef.current;
    if (!canvas || buffers.length === 0) return;
    secureCanvas(canvas);
    canvas.width = 800;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const data = buffers[0].getChannelData(0);
    const step = Math.ceil(data.length / canvas.width);
    const amp = canvas.height / 2;

    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < canvas.width; i++) {
      const min = Math.min(...Array.from({ length: step }, (_, j) => data[i * step + j] || 0));
      const max = Math.max(...Array.from({ length: step }, (_, j) => data[i * step + j] || 0));
      ctx.moveTo(i, (1 + min) * amp);
      ctx.lineTo(i, (1 + max) * amp);
    }
    ctx.stroke();
  };

  const togglePlay = async () => {
    const ctx = audioCtxRef.current;
    if (!ctx || buffersRef.current.length === 0) return;

    if (playing) {
      sourceRef.current?.stop();
      setPlaying(false);
      return;
    }

    sourceRef.current?.stop();
    const source = ctx.createBufferSource();
    source.buffer = buffersRef.current[0];
    source.connect(ctx.destination);
    source.onended = () => setPlaying(false);
    source.start();
    sourceRef.current = source;
    setPlaying(true);
  };

  return (
    <DevToolsDetector>
      <AntiCapture>
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
              <span className="text-zinc-400 text-sm">{chunkCount} chunks loaded</span>
            </div>
          </div>
        </FocusGuard>
      </AntiCapture>
    </DevToolsDetector>
  );
}
