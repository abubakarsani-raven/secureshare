'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useViewSession } from '@/context/ViewSessionContext';
import { Mail, Lock, AlertTriangle } from 'lucide-react';

type GateState = 'EMAIL_INPUT' | 'OTP_INPUT' | 'VERIFIED' | 'LOCKED';

interface OTPGateProps {
  token: string;
  otpRequired: boolean;
  children: React.ReactNode;
  onVerified?: () => void;
}

export default function OTPGate({ token, otpRequired, children, onVerified }: OTPGateProps) {
  const [state, setState] = useState<GateState>('EMAIL_INPUT');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Even when OTP is not required we must complete the verify handshake to
  // obtain a view session token, so the gate always starts unverified.
  const [verified, setVerified] = useState(false);
  const { setSession } = useViewSession();

  const decodeJwtPayload = (jwt: string): { keyFragmentA?: string } => {
    try {
      const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(part));
    } catch {
      return {};
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const sendResult = await apiFetch<{ sent: boolean; otpRequired?: boolean }>('/api/otp/send', {
        method: 'POST',
        body: JSON.stringify({ token, email }),
      });

      if (!otpRequired || sendResult.otpRequired === false) {
        const data = await apiFetch<{ verified: boolean; sessionToken: string }>('/api/otp/verify', {
          method: 'POST',
          body: JSON.stringify({ token, email, code: '000000' }),
        });
        const payload = decodeJwtPayload(data.sessionToken);
        setSession(data.sessionToken, payload.keyFragmentA || '');
        setVerified(true);
        setState('VERIFIED');
        onVerified?.();
        return;
      }

      setState('OTP_INPUT');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiFetch<{ verified: boolean; sessionToken: string }>('/api/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ token, email, code }),
      });
      const payload = decodeJwtPayload(data.sessionToken);
      setSession(data.sessionToken, payload.keyFragmentA || '');
      setVerified(true);
      setState('VERIFIED');
      onVerified?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed';
      if (msg.includes('Too many attempts') || msg.includes('locked')) {
        setState('LOCKED');
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (verified || state === 'VERIFIED') {
    return <>{children}</>;
  }

  if (state === 'LOCKED') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] p-8 bg-red-50 rounded-xl border border-red-200">
        <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
        <h2 className="text-lg font-semibold text-red-800">Too many attempts</h2>
        <p className="text-red-600 mt-2">This link has been locked. Contact the sender for a new share.</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-8 bg-white rounded-xl shadow-lg border">
      <div className="flex items-center gap-3 mb-6">
        {state === 'EMAIL_INPUT' ? (
          <Mail className="w-8 h-8 text-primary" />
        ) : (
          <Lock className="w-8 h-8 text-primary" />
        )}
        <div>
          <h2 className="text-xl font-semibold">
            {state === 'EMAIL_INPUT' ? 'Verify your identity' : 'Enter verification code'}
          </h2>
          <p className="text-sm text-zinc-500">
            {state === 'EMAIL_INPUT'
              ? 'Enter the recipient email to receive a code'
              : 'Check your email for the 6-digit code'}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      {state === 'EMAIL_INPUT' ? (
        <form onSubmit={handleSendOtp} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Recipient email"
            required
            className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary-dark disabled:opacity-50"
          >
            {loading ? 'Sending...' : otpRequired ? 'Send verification code' : 'Continue'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            required
            className="w-full px-4 py-3 border rounded-lg text-center text-2xl tracking-[0.5em] font-mono focus:ring-2 focus:ring-primary outline-none"
          />
          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary-dark disabled:opacity-50"
          >
            {loading ? 'Verifying...' : 'Verify'}
          </button>
          <button
            type="button"
            onClick={() => setState('EMAIL_INPUT')}
            className="w-full py-2 text-sm text-zinc-500 hover:text-zinc-700"
          >
            Use different email
          </button>
        </form>
      )}
    </div>
  );
}
