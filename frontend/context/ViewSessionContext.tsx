'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { setViewSessionToken as setApiViewToken } from '@/lib/api';

interface ViewSessionContextType {
  sessionToken: string | null;
  keyFragmentA: string | null;
  setSession: (token: string, fragmentA: string) => void;
  clearSession: () => void;
}

const ViewSessionContext = createContext<ViewSessionContextType | null>(null);

export function ViewSessionProvider({ children }: { children: React.ReactNode }) {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [keyFragmentA, setKeyFragmentA] = useState<string | null>(null);

  const setSession = useCallback((token: string, fragmentA: string) => {
    setSessionToken(token);
    setKeyFragmentA(fragmentA);
    setApiViewToken(token);
  }, []);

  const clearSession = useCallback(() => {
    setSessionToken(null);
    setKeyFragmentA(null);
    setApiViewToken(null);
  }, []);

  return (
    <ViewSessionContext.Provider value={{ sessionToken, keyFragmentA, setSession, clearSession }}>
      {children}
    </ViewSessionContext.Provider>
  );
}

export function useViewSession() {
  const ctx = useContext(ViewSessionContext);
  if (!ctx) throw new Error('useViewSession must be used within ViewSessionProvider');
  return ctx;
}
