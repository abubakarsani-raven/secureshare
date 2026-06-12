'use client';

import { useCallback, useEffect, useState } from 'react';
import { MapPin, AlertTriangle } from 'lucide-react';
import { requestLocation } from '@/lib/geolocation';
import { setViewerGeo } from '@/lib/api';

interface Props {
  children: React.ReactNode;
  // Called once location is granted, so the parent can begin loading content
  // (which then carries the geo headers into the audit trail).
  onLocated: () => void;
}

type State = 'prompt' | 'requesting' | 'granted' | 'denied';

// Requires the viewer to share precise location before any content is shown.
// The coordinates are attached to subsequent view requests and recorded in the
// share's audit log, so a leaked view can be traced to where it was opened.
export default function GeoGate({ children, onLocated }: Props) {
  const [state, setState] = useState<State>('prompt');
  const [error, setError] = useState('');

  const ask = useCallback(async () => {
    setState('requesting');
    setError('');
    try {
      const geo = await requestLocation();
      setViewerGeo(geo);
      setState('granted');
      onLocated();
    } catch (err) {
      setViewerGeo(null);
      setError(err instanceof Error ? err.message : 'Location access denied');
      setState('denied');
    }
  }, [onLocated]);

  // Attempt immediately; if the browser shows its own permission dialog the
  // user resolves it inline, otherwise our prompt/retry UI takes over.
  useEffect(() => {
    ask();
  }, [ask]);

  if (state === 'granted') return <>{children}</>;

  return (
    <div className="max-w-md mx-auto p-8 bg-white rounded-xl shadow-lg border text-center">
      {state === 'denied' ? (
        <>
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">Location access required</h2>
          <p className="text-sm text-zinc-600 mb-4">
            This content can only be viewed with location sharing enabled. Please allow location
            access in your browser and try again.
          </p>
          {error && <p className="text-xs text-zinc-400 mb-4">{error}</p>}
          <button
            onClick={ask}
            className="px-4 py-2 bg-primary text-white rounded-lg font-medium"
          >
            Enable location & continue
          </button>
        </>
      ) : (
        <>
          <MapPin className="w-12 h-12 text-primary mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">Verifying location</h2>
          <p className="text-sm text-zinc-600">
            Please allow location access when prompted to view this content.
          </p>
        </>
      )}
    </div>
  );
}
