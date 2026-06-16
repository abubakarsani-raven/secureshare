'use client';

import { useEffect } from 'react';
import { apiFetch } from '@/lib/api';

export default function AntiCapture({ token, children }: { token?: string; children: React.ReactNode }) {
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();

    // Best-effort "possible capture" reporting. The browser exposes no true
    // screenshot API, so these are heuristics (a PrintScreen keypress, a
    // screen-recording attempt, the viewer losing focus). They are throttled and
    // logged to the sender's audit trail as signals — not proof. The forensic
    // watermark is what actually traces a leak.
    const lastSent: Record<string, number> = {};
    const report = (type: 'screenshot' | 'recording' | 'focus_lost') => {
      if (!token) return;
      const now = Date.now();
      if (now - (lastSent[type] || 0) < 8000) return; // throttle noisy signals
      lastSent[type] = now;
      apiFetch(`/api/view/${token}/capture-event`, {
        method: 'POST',
        viewSession: true,
        body: JSON.stringify({ type }),
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => {}); // fire-and-forget; never block the viewer
    };

    const keydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['p', 's', 'c', 'u'].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
      if (e.key === 'PrintScreen') {
        report('screenshot');
        document.querySelectorAll('canvas').forEach((c) => {
          (c as HTMLCanvasElement).style.display = 'none';
          setTimeout(() => {
            (c as HTMLCanvasElement).style.display = '';
          }, 1000);
        });
      }
    };

    const originalGetDisplayMedia = navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices);
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getDisplayMedia = () => {
        report('recording');
        return Promise.reject(new DOMException('Screen capture blocked', 'NotAllowedError'));
      };
    }

    // Focus/visibility loss can accompany an OS capture tool opening — a weak,
    // high-false-positive signal, so it is throttled and labelled as such.
    const onHidden = () => {
      if (document.visibilityState === 'hidden') report('focus_lost');
    };

    document.addEventListener('contextmenu', prevent);
    document.addEventListener('keydown', keydown);
    document.addEventListener('visibilitychange', onHidden);

    const style = document.createElement('style');
    style.textContent = '.secure-content, .secure-content * { user-select: none !important; -webkit-user-select: none !important; }';
    document.head.appendChild(style);

    return () => {
      document.removeEventListener('contextmenu', prevent);
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('visibilitychange', onHidden);
      if (originalGetDisplayMedia && navigator.mediaDevices) {
        navigator.mediaDevices.getDisplayMedia = originalGetDisplayMedia;
      }
      style.remove();
    };
  }, [token]);

  return <div className="secure-content">{children}</div>;
}
