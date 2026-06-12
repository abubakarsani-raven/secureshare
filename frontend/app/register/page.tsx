'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Shield } from 'lucide-react';
import QRCode from 'qrcode';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [qrCode, setQrCode] = useState('');
  const [showTotp, setShowTotp] = useState(false);
  const { register } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { otpauthUrl } = await register(email, password);
      const qr = await QRCode.toDataURL(otpauthUrl);
      setQrCode(qr);
      setShowTotp(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  if (showTotp) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center bg-white p-8 rounded-xl shadow-lg border">
          <h1 className="text-2xl font-semibold mb-4">Set up 2FA</h1>
          <p className="text-zinc-600 mb-6">Scan this QR code with your authenticator app</p>
          {qrCode && <img src={qrCode} alt="2FA QR" className="mx-auto mb-6 w-48 h-48" />}
          <button onClick={() => router.push('/dashboard')} className="w-full py-3 bg-primary text-white rounded-lg font-medium">
            Continue to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2 mb-8 font-bold text-xl">
          <Shield className="w-7 h-7 text-primary" /> SecureShare
        </Link>
        <form onSubmit={handleSubmit} className="bg-white p-8 rounded-xl shadow-lg border space-y-4">
          <h1 className="text-2xl font-semibold text-center">Create account</h1>
          {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full px-4 py-3 border rounded-lg" />
          <input type="password" placeholder="Password (8+ chars, upper, number, special)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="w-full px-4 py-3 border rounded-lg" />
          <button type="submit" disabled={loading} className="w-full py-3 bg-primary text-white rounded-lg font-medium disabled:opacity-50">
            {loading ? 'Creating...' : 'Create account'}
          </button>
          <p className="text-center text-sm text-zinc-500">
            Have an account? <Link href="/login" className="text-primary hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
