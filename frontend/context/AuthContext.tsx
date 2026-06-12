'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { apiFetch, setAccessToken as setApiToken } from '@/lib/api';

interface User {
  userId: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  login: (email: string, password: string, totpCode?: string) => Promise<{ requiresTotp?: boolean }>;
  register: (email: string, password: string) => Promise<{ otpauthUrl: string }>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const REFRESH_STORAGE_KEY = 'ss_refresh_token';

function decodeJwtPayload(token: string): { userId?: string; email?: string } {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const setTokens = useCallback((access: string, refresh: string, email: string, userId: string) => {
    setAccessTokenState(access);
    setApiToken(access);
    setUser({ email, userId });
    try {
      sessionStorage.setItem(REFRESH_STORAGE_KEY, refresh);
    } catch {
      // storage unavailable (private mode) — session just won't survive reloads
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setAccessTokenState(null);
    setApiToken(null);
    try {
      sessionStorage.removeItem(REFRESH_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  // Restore the session on reload from the stored refresh token; without this
  // every page refresh silently logged the user out.
  useEffect(() => {
    const restore = async () => {
      let stored: string | null = null;
      try {
        stored = sessionStorage.getItem(REFRESH_STORAGE_KEY);
      } catch {
        // ignore
      }
      if (!stored) {
        setIsLoading(false);
        return;
      }
      try {
        const data = await apiFetch<{ accessToken: string }>('/api/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: stored }),
        });
        const payload = decodeJwtPayload(data.accessToken);
        setAccessTokenState(data.accessToken);
        setApiToken(data.accessToken);
        if (payload.userId && payload.email) {
          setUser({ userId: payload.userId, email: payload.email });
        }
      } catch {
        try {
          sessionStorage.removeItem(REFRESH_STORAGE_KEY);
        } catch {
          // ignore
        }
      } finally {
        setIsLoading(false);
      }
    };
    restore();
  }, []);

  const login = async (email: string, password: string, totpCode?: string) => {
    try {
      const data = await apiFetch<{
        accessToken: string;
        refreshToken: string;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, totpCode }),
      });

      const payload = decodeJwtPayload(data.accessToken);
      setTokens(data.accessToken, data.refreshToken, email, payload.userId || '');
      return {};
    } catch (err) {
      const e = err as Error & { requiresTotp?: boolean };
      if (e.requiresTotp) return { requiresTotp: true };
      throw err;
    }
  };

  const register = async (email: string, password: string) => {
    const data = await apiFetch<{
      accessToken: string;
      refreshToken: string;
      otpauthUrl: string;
    }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    const payload = decodeJwtPayload(data.accessToken);
    setTokens(data.accessToken, data.refreshToken, email, payload.userId || '');
    return { otpauthUrl: data.otpauthUrl };
  };

  return (
    <AuthContext.Provider value={{ user, accessToken, login, register, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
