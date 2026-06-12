'use client';

import { useState } from 'react';
import QRCode from 'qrcode';
import { uploadFile, apiFetch } from '@/lib/api';
import {
  generateRandomFragment,
  xorFragments,
  encryptWithCombinedKey,
} from '@/lib/crypto';
import { Copy, Mail, Share2 } from 'lucide-react';

type ShareType = 'document' | 'image' | 'video' | 'audio' | 'message';

interface ShareFormProps {
  type: ShareType;
  accept?: string;
  fileLabel: string;
  showSelfDestruct?: boolean;
}

export default function ShareForm({ type, accept, fileLabel, showSelfDestruct }: ShareFormProps) {
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [expiry, setExpiry] = useState('24hr');
  const [maxViews, setMaxViews] = useState('1');
  const [otpRequired, setOtpRequired] = useState(true);
  const [selfDestruct, setSelfDestruct] = useState('30');
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setProgress(0);

    try {
      if (type === 'message') {
        const fragmentC = generateRandomFragment();
        const contentKey = generateRandomFragment();
        const fragmentB = xorFragments(contentKey, fragmentC);
        const combined = contentKey;
        const encrypted = await encryptWithCombinedKey(message, combined);

        const data = await apiFetch<{ token: string; shareUrl: string }>('/api/upload/message', {
          method: 'POST',
          auth: true,
          body: JSON.stringify({
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            salt: '',
            keyFragmentB: fragmentB,
            recipientName,
            recipientEmail,
            maxViews: maxViews === 'unlimited' ? 999999 : parseInt(maxViews),
            expiresAt: expiryToDate(expiry),
            selfDestructSeconds: parseInt(selfDestruct),
            otpRequired,
          }),
        });
        const url = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/view/${data.token}#k=${fragmentC}`;
        setShareUrl(url);
        setQrDataUrl(await QRCode.toDataURL(url));
      } else {
        if (!file) throw new Error('File required');
        const formData = new FormData();
        formData.append('file', file);
        formData.append('recipientName', recipientName);
        formData.append('recipientEmail', recipientEmail);
        formData.append('expiry', expiry);
        formData.append('maxViews', maxViews === 'unlimited' ? '999999' : maxViews);
        formData.append('otpRequired', String(otpRequired));

        const data = await uploadFile(`/api/upload/${type}`, formData, setProgress);
        setShareUrl(data.shareUrl);
        setQrDataUrl(await QRCode.toDataURL(data.shareUrl));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const copyLink = () => navigator.clipboard.writeText(shareUrl);

  if (shareUrl) {
    return (
      <div className="max-w-lg mx-auto p-8 bg-white rounded-xl shadow-lg border text-center">
        <h2 className="text-xl font-semibold mb-4 text-green-700">Share link created!</h2>
        {qrDataUrl && <img src={qrDataUrl} alt="QR Code" className="mx-auto mb-4 w-48 h-48" />}
        <div className="bg-zinc-100 p-3 rounded-lg text-sm break-all mb-4">{shareUrl}</div>
        <div className="flex flex-wrap gap-2 justify-center">
          <button onClick={copyLink} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg">
            <Copy className="w-4 h-4" /> Copy link
          </button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareUrl)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg"
          >
            <Share2 className="w-4 h-4" /> WhatsApp
          </a>
          <a
            href={`mailto:?subject=SecureShare&body=${encodeURIComponent(shareUrl)}`}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-600 text-white rounded-lg"
          >
            <Mail className="w-4 h-4" /> Email
          </a>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg mx-auto space-y-4">
      {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      <div>
        <label className="block text-sm font-medium mb-1">Recipient name</label>
        <input
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          required
          className="w-full px-4 py-2 border rounded-lg"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Recipient email</label>
        <input
          type="email"
          value={recipientEmail}
          onChange={(e) => setRecipientEmail(e.target.value)}
          required
          className="w-full px-4 py-2 border rounded-lg"
        />
      </div>

      {type === 'message' ? (
        <div>
          <label className="block text-sm font-medium mb-1">Message (max 10,000 chars)</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 10000))}
            required
            rows={6}
            className="w-full px-4 py-2 border rounded-lg"
          />
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium mb-1">{fileLabel}</label>
          <input
            type="file"
            accept={accept}
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            required
            className="w-full text-sm"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Expiry</label>
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="w-full px-4 py-2 border rounded-lg">
            <option value="1hr">1 hour</option>
            <option value="6hr">6 hours</option>
            <option value="24hr">24 hours</option>
            <option value="48hr">48 hours</option>
            <option value="7days">7 days</option>
            <option value="never">Never</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Max views</label>
          <select value={maxViews} onChange={(e) => setMaxViews(e.target.value)} className="w-full px-4 py-2 border rounded-lg">
            <option value="1">1</option>
            <option value="3">3</option>
            <option value="5">5</option>
            <option value="10">10</option>
            <option value="unlimited">Unlimited</option>
          </select>
        </div>
      </div>

      {showSelfDestruct && (
        <div>
          <label className="block text-sm font-medium mb-1">Self-destruct after viewing</label>
          <select value={selfDestruct} onChange={(e) => setSelfDestruct(e.target.value)} className="w-full px-4 py-2 border rounded-lg">
            <option value="10">10 seconds</option>
            <option value="30">30 seconds</option>
            <option value="60">1 minute</option>
            <option value="300">5 minutes</option>
          </select>
        </div>
      )}

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={otpRequired} onChange={(e) => setOtpRequired(e.target.checked)} />
        <span className="text-sm">Require OTP verification</span>
      </label>

      {loading && progress > 0 && (
        <div className="w-full bg-zinc-200 rounded-full h-2">
          <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 bg-primary text-white rounded-lg font-medium disabled:opacity-50"
      >
        {loading ? `Uploading${progress > 0 ? ` ${progress}%` : '...'}` : 'Create secure link'}
      </button>
    </form>
  );
}

function expiryToDate(option: string): string | null {
  const map: Record<string, number> = {
    '1hr': 3600000,
    '6hr': 6 * 3600000,
    '24hr': 24 * 3600000,
    '48hr': 48 * 3600000,
    '7days': 7 * 24 * 3600000,
  };
  const ms = map[option];
  if (!ms) return null;
  return new Date(Date.now() + ms).toISOString();
}
