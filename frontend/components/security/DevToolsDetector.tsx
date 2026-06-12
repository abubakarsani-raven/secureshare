'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';

export default function DevToolsDetector({ children }: { children: React.ReactNode }) {
  const [detected, setDetected] = useState(false);

  useEffect(() => {
    const check = () => {
      const widthDiff = window.outerWidth - window.innerWidth > 160;
      const heightDiff = window.outerHeight - window.innerHeight > 160;
      if (widthDiff || heightDiff) setDetected(true);
    };

    const element = new Image();
    Object.defineProperty(element, 'id', {
      get() {
        setDetected(true);
        return '';
      },
    });

    const interval = setInterval(() => {
      check();
      console.log('%c', element as unknown as string);
    }, 1000);

    window.addEventListener('resize', check);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', check);
    };
  }, []);

  if (detected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] bg-zinc-900 text-white p-8 rounded-xl">
        <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-xl font-semibold">Content hidden for security</h2>
        <p className="text-zinc-400 mt-2">Please close developer tools to view this content.</p>
      </div>
    );
  }

  return <>{children}</>;
}
