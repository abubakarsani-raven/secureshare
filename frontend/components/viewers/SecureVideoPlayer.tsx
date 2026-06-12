'use client';

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { getViewSessionToken } from '@/lib/api';
import { getFingerprint } from '@/lib/fingerprint';
import { secureCanvas } from '@/lib/secureCanvas';
import AntiCapture from '@/components/security/AntiCapture';
import FocusGuard from '@/components/security/FocusGuard';
import DevToolsDetector from '@/components/security/DevToolsDetector';
import { Play, Pause, Volume2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Props {
  token: string;
}

export default function SecureVideoPlayer({ token }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.playsInline = true;
    videoRef.current = video;

    const canvas = canvasRef.current;
    if (canvas) secureCanvas(canvas);

    const drawFrame = () => {
      const ctx = canvas?.getContext('2d');
      if (ctx && video.readyState >= 2) {
        if (canvas!.width !== video.videoWidth) {
          canvas!.width = video.videoWidth || 640;
          canvas!.height = video.videoHeight || 360;
        }
        ctx.drawImage(video, 0, 0, canvas!.width, canvas!.height);
      }
      if (playing) requestAnimationFrame(drawFrame);
    };

    const init = async () => {
      const sessionToken = getViewSessionToken();
      const fp = await getFingerprint();
      const playlistUrl = `${API_URL}/api/view/${token}/video/playlist`;

      if (Hls.isSupported()) {
        const hls = new Hls({
          xhrSetup(xhr) {
            if (sessionToken) xhr.setRequestHeader('X-View-Session', sessionToken);
            xhr.setRequestHeader('X-Device-Fingerprint', fp);
          },
        });
        hlsRef.current = hls;
        hls.loadSource(playlistUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => setLoading(false));
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = playlistUrl;
        setLoading(false);
      }
    };

    init();
    if (playing) requestAnimationFrame(drawFrame);

    return () => {
      hlsRef.current?.destroy();
      video.remove();
    };
  }, [token, playing]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.pause();
      setPlaying(false);
    } else {
      video.play();
      setPlaying(true);
      const canvas = canvasRef.current;
      const draw = () => {
        const ctx = canvas?.getContext('2d');
        if (ctx && video.readyState >= 2 && canvas) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
        if (!video.paused) requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
    }
  };

  return (
    <DevToolsDetector>
      <AntiCapture>
        <FocusGuard>
          <div className="relative bg-black rounded-lg overflow-hidden">
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center text-white z-10">
                Loading video...
              </div>
            )}
            <canvas ref={canvasRef} className="w-full max-h-[70vh]" width={640} height={360} />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 p-4 flex items-center gap-4">
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
