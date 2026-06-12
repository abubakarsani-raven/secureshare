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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessTokenState] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const setTokens = useCallback((access: string, refresh: string, email: string, userId: string) => {
    setAccessTokenState(access);
    setRefreshToken(refresh);
    setApiToken(access);
    setUser({ email, userId });
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setAccessTokenState(null);
    setRefreshToken(null);
    setApiToken(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!refreshToken) return false;
    try {
      const data = await apiFetch<{ accessToken: string }>('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
      setAccessTokenState(data.accessToken);
      setApiToken(data.accessToken);
      return true;
    } catch {
      logout();
      return false;
    }
  }, [refreshToken, logout]);

  useEffect(() => {
    setIsLoading(false);
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

      const payload = JSON.parse(atob(data.accessToken.split('.')[1]));
      setTokens(data.accessToken, data.refreshToken, email, payload.userId);
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

    const payload = JSON.parse(atob(data.accessToken.split('.')[1]));
    setTokens(data.accessToken, data.refreshToken, email, payload.userId);
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
