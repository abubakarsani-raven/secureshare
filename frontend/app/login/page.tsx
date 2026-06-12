'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Shield } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email, password, totpCode || undefined);
      if (result.requiresTotp) {
        setRequiresTotp(true);
      } else {
        router.push('/dashboard');
      }
    } catch (err) {
      const e = err as Error & { requiresTotp?: boolean };
      if (e.requiresTotp) {
        setRequiresTotp(true);
        return;
      }
      setError(e.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2 mb-8 font-bold text-xl">
          <Shield className="w-7 h-7 text-primary" /> SecureShare
        </Link>
        <form onSubmit={handleSubmit} className="bg-white p-8 rounded-xl shadow-lg border space-y-4">
          <h1 className="text-2xl font-semibold text-center">Sign in</h1>
          {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full px-4 py-3 border rounded-lg" />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full px-4 py-3 border rounded-lg" />
          {requiresTotp && (
            <input type="text" placeholder="2FA code" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} maxLength={6} className="w-full px-4 py-3 border rounded-lg text-center tracking-widest" />
          )}
          <button type="submit" disabled={loading} className="w-full py-3 bg-primary text-white rounded-lg font-medium disabled:opacity-50">
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
          <p className="text-center text-sm text-zinc-500">
            No account? <Link href="/register" className="text-primary hover:underline">Register</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
