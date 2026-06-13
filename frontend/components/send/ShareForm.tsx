'use client';

import { useState } from 'react';
import QRCode from 'qrcode';
import { uploadFile, apiFetch } from '@/lib/api';
import { generateRandomFragment, xorFragments, encryptWithCombinedKey } from '@/lib/crypto';
import { Copy, Mail, Plus, Trash2, Check } from 'lucide-react';

type ShareType = 'document' | 'image' | 'video' | 'audio' | 'message';

interface ShareFormProps {
  type: ShareType;
  accept?: string;
  fileLabel: string;
  showSelfDestruct?: boolean;
}

interface RecipientRow {
  name: string;
  email: string;
}

interface CreatedShare {
  recipientName: string;
  recipientEmail: string;
  token: string;
  shareUrl: string;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export default function ShareForm({ type, accept, fileLabel, showSelfDestruct }: ShareFormProps) {
  const [recipients, setRecipients] = useState<RecipientRow[]>([{ name: '', email: '' }]);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [expiry, setExpiry] = useState('24hr');
  const [maxViews, setMaxViews] = useState('1');
  const [otpRequired, setOtpRequired] = useState(true);
  const [selfDestruct, setSelfDestruct] = useState('30');
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [shares, setShares] = useState<CreatedShare[]>([]);
  const [sharesWithQr, setSharesWithQr] = useState<(CreatedShare & { qr: string })[]>([]);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [error, setError] = useState('');

  const updateRecipient = (i: number, field: keyof RecipientRow, value: string) => {
    setRecipients((rs) => rs.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  };
  const addRecipient = () => setRecipients((rs) => [...rs, { name: '', email: '' }]);
  const removeRecipient = (i: number) => setRecipients((rs) => rs.filter((_, idx) => idx !== i));

  const cleanRecipients = () =>
    recipients
      .map((r) => ({ name: r.name.trim(), email: r.email.trim() }))
      .filter((r) => r.name && r.email);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const list = cleanRecipients();
    if (list.length === 0) {
      setError('Add at least one recipient');
      return;
    }
    setLoading(true);
    setProgress(0);

    try {
      if (type === 'message') {
        // Each recipient gets a unique encryption + key split, so a leaked copy
        // traces to exactly one person.
        const fragmentCById = new Map<string, string>();
        const messages = await Promise.all(
          list.map(async (r) => {
            const fragmentC = generateRandomFragment();
            const contentKey = generateRandomFragment();
            const fragmentB = xorFragments(contentKey, fragmentC);
            const encrypted = await encryptWithCombinedKey(message, contentKey);
            fragmentCById.set(r.email, fragmentC);
            return {
              ciphertext: encrypted.ciphertext,
              iv: encrypted.iv,
              salt: '',
              keyFragmentB: fragmentB,
              name: r.name,
              email: r.email,
            };
          })
        );

        const data = await apiFetch<{ shares: CreatedShare[] }>('/api/upload/message', {
          method: 'POST',
          auth: true,
          body: JSON.stringify({
            messages,
            maxViews: maxViews === 'unlimited' ? 999999 : parseInt(maxViews),
            expiresAt: expiryToDate(expiry),
            selfDestructSeconds: parseInt(selfDestruct),
            otpRequired,
          }),
        });

        // Append each recipient's URL-hash fragment to their link.
        const withFragments = data.shares.map((s) => ({
          ...s,
          shareUrl: `${APP_URL}/view/${s.token}#k=${fragmentCById.get(s.recipientEmail) || ''}`,
        }));
        await finishWithShares(withFragments);
      } else {
        if (!file) throw new Error('File required');
        const formData = new FormData();
        formData.append('file', file);
        formData.append('recipients', JSON.stringify(list));
        formData.append('expiry', expiry);
        formData.append('maxViews', maxViews === 'unlimited' ? '999999' : maxViews);
        formData.append('otpRequired', String(otpRequired));

        const data = await uploadFile(`/api/upload/${type}`, formData, setProgress);
        await finishWithShares(data.shares);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const finishWithShares = async (list: CreatedShare[]) => {
    const withQr = await Promise.all(
      list.map(async (s) => ({ ...s, qr: await QRCode.toDataURL(s.shareUrl) }))
    );
    setSharesWithQr(withQr);
    setShares(list);
  };

  const copyLink = (s: CreatedShare) => {
    navigator.clipboard.writeText(s.shareUrl);
    setCopiedToken(s.token);
    setTimeout(() => setCopiedToken((t) => (t === s.token ? null : t)), 1500);
  };

  if (shares.length > 0) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-center">
          <h2 className="text-lg font-semibold text-green-800">
            {shares.length} uniquely-watermarked {shares.length === 1 ? 'link' : 'links'} created
          </h2>
          <p className="text-sm text-green-700 mt-1">
            Each recipient gets their own traceable copy. Send each person only their own link.
          </p>
        </div>

        {sharesWithQr.map((s) => (
          <div key={s.token} className="p-4 bg-white border rounded-xl dark:bg-zinc-900 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="min-w-0">
                <p className="font-medium truncate">{s.recipientName}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{s.recipientEmail}</p>
              </div>
              {s.qr && <img src={s.qr} alt="QR" className="w-14 h-14 shrink-0" />}
            </div>
            <div className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded text-xs break-all mb-2">{s.shareUrl}</div>
            <div className="flex gap-2">
              <button
                onClick={() => copyLink(s)}
                className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white rounded-lg text-sm"
              >
                {copiedToken === s.token ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copiedToken === s.token ? 'Copied' : 'Copy'}
              </button>
              <a
                href={`mailto:${encodeURIComponent(s.recipientEmail)}?subject=Secure document&body=${encodeURIComponent(s.shareUrl)}`}
                className="flex items-center gap-1 px-3 py-1.5 bg-zinc-600 text-white rounded-lg text-sm"
              >
                <Mail className="w-4 h-4" /> Email
              </a>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg mx-auto space-y-4">
      {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium">Recipients</label>
          <span className="text-xs text-zinc-500">Each gets a unique, traceable copy</span>
        </div>
        <div className="space-y-2">
          {recipients.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={r.name}
                onChange={(e) => updateRecipient(i, 'name', e.target.value)}
                placeholder="Name"
                className="w-2/5 px-3 py-2 border rounded-lg text-sm dark:bg-zinc-800 dark:border-zinc-700"
              />
              <input
                type="email"
                value={r.email}
                onChange={(e) => updateRecipient(i, 'email', e.target.value)}
                placeholder="email@example.com"
                className="flex-1 px-3 py-2 border rounded-lg text-sm dark:bg-zinc-800 dark:border-zinc-700"
              />
              {recipients.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRecipient(i)}
                  className="px-2 text-zinc-400 hover:text-red-500"
                  aria-label="Remove recipient"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addRecipient}
          className="mt-2 flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <Plus className="w-4 h-4" /> Add recipient
        </button>
      </div>

      {type === 'message' ? (
        <div>
          <label className="block text-sm font-medium mb-1">Message (max 10,000 chars)</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 10000))}
            required
            rows={6}
            className="w-full px-4 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700"
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
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="w-full px-4 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700">
            <option value="1hr">1 hour</option>
            <option value="6hr">6 hours</option>
            <option value="24hr">24 hours</option>
            <option value="48hr">48 hours</option>
            <option value="7days">7 days</option>
            <option value="never">Never</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Max views (per recipient)</label>
          <select value={maxViews} onChange={(e) => setMaxViews(e.target.value)} className="w-full px-4 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700">
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
          <select value={selfDestruct} onChange={(e) => setSelfDestruct(e.target.value)} className="w-full px-4 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-700">
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
        {loading
          ? `Creating watermarked copies${progress > 0 ? ` ${progress}%` : '...'}`
          : `Create ${cleanRecipients().length || ''} traceable ${cleanRecipients().length === 1 ? 'link' : 'links'}`}
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
