'use client';

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { getViewSessionToken, getViewerGeoHeaders } from '@/lib/api';
import { getFingerprint } from '@/lib/fingerprint';
import { secureCanvas } from '@/lib/secureCanvas';
import AntiCapture from '@/components/security/AntiCapture';
import FocusGuard from '@/components/security/FocusGuard';
import DevToolsDetector from '@/components/security/DevToolsDetector';
import GpuWatermark from '@/components/security/GpuWatermark';
import { Play, Pause, Volume2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Props {
  token: string;
  watermark: string;
}

export default function SecureVideoPlayer({ token, watermark }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);

  // Initialize once per token. `playing` must NOT be a dependency here:
  // re-running this effect on play/pause would destroy the HLS instance and
  // restart playback from zero.
  useEffect(() => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.playsInline = true;
    videoRef.current = video;

    const canvas = canvasRef.current;
    if (canvas) secureCanvas(canvas);

    const init = async () => {
      const sessionToken = getViewSessionToken();
      const fp = await getFingerprint();
      const playlistUrl = `${API_URL}/api/view/${token}/video/playlist`;

      if (Hls.isSupported()) {
        const hls = new Hls({
          xhrSetup(xhr) {
            if (sessionToken) xhr.setRequestHeader('X-View-Session', sessionToken);
            xhr.setRequestHeader('X-Device-Fingerprint', fp);
            for (const [k, v] of Object.entries(getViewerGeoHeaders())) {
              xhr.setRequestHeader(k, v);
            }
          },
        });
        hlsRef.current = hls;
        hls.loadSource(playlistUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => setLoading(false));
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari's native HLS loader cannot send custom headers, so the
        // session travels as a query parameter (the backend accepts both and
        // propagates it to segment URLs when rewriting the playlist).
        video.src = sessionToken
          ? `${playlistUrl}?session=${encodeURIComponent(sessionToken)}`
          : playlistUrl;
        setLoading(false);
      }
    };

    init();

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.remove();
    };
  }, [token]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      setPlaying(false);
    } else {
      video.play();
      setPlaying(true);
      const canvas = canvasRef.current;
      const draw = () => {
        const ctx = canvas?.getContext('2d');
        if (ctx && canvas && video.readyState >= 2) {
          if (canvas.width !== video.videoWidth && video.videoWidth > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
        if (!video.paused) requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
    }
  };

  return (
    <DevToolsDetector>
      <AntiCapture token={token}>
        <FocusGuard>
          <div className="relative bg-black rounded-lg overflow-hidden">
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center text-white z-10">
                Loading video...
              </div>
            )}
            <canvas ref={canvasRef} className="w-full max-h-[70vh]" width={640} height={360} />
            <GpuWatermark label={watermark} dark={true} />
            <div className="absolute bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-black/80 p-4 flex items-center gap-4">
              <button onClick={togglePlay} className="text-white p-2 hover:bg-white/20 rounded">
                {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
              </button>
              <Volume2 className="w-5 h-5 text-white" />
            </div>
          </div>
        </FocusGuard>
      </AntiCapture>
    </DevToolsDetector>
  );
}
