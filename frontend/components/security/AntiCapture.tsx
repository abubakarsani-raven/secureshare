'use client';

import { useEffect } from 'react';

export default function AntiCapture({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();

    const keydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['p', 's', 'c', 'u'].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
      if (e.key === 'PrintScreen') {
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
      navigator.mediaDevices.getDisplayMedia = () =>
        Promise.reject(new DOMException('Screen capture blocked', 'NotAllowedError'));
    }

    document.addEventListener('contextmenu', prevent);
    document.addEventListener('keydown', keydown);

    const style = document.createElement('style');
    style.textContent = '.secure-content, .secure-content * { user-select: none !important; -webkit-user-select: none !important; }';
    document.head.appendChild(style);

    return () => {
      document.removeEventListener('contextmenu', prevent);
      document.removeEventListener('keydown', keydown);
      if (originalGetDisplayMedia && navigator.mediaDevices) {
        navigator.mediaDevices.getDisplayMedia = originalGetDisplayMedia;
      }
      style.remove();
    };
  }, []);

  return <div className="secure-content">{children}</div>;
}
