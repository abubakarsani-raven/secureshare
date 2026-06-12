'use client';

import { useEffect, useState } from 'react';

export default function FocusGuard({ children }: { children: React.ReactNode }) {
  const [blurred, setBlurred] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onVisibility = () => setBlurred(document.hidden);
    const onBlur = () => setBlurred(true);
    const onFocus = () => setBlurred(false);
    const onOrientation = () => {
      setHidden(true);
      setTimeout(() => setHidden(false), 100);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('orientationchange', onOrientation);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('orientationchange', onOrientation);
    };
  }, []);

  return (
    <div
      style={{
        filter: blurred ? 'blur(20px)' : 'none',
        visibility: hidden ? 'hidden' : 'visible',
        transition: 'filter 0.2s',
      }}
    >
      {children}
    </div>
  );
}
