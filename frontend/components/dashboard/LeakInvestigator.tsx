'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Search, Upload } from 'lucide-react';

interface ShareMatch {
  recipientName: string;
  emailHint: string;
  shareId: string;
  type: string;
  createdAt: string;
  viewCount: number;
  confidence: number;
}

interface ExtractResult {
  found: boolean;
  method?: string;
  payload?: {
    recipientId: string;
    documentId: string;
    sessionId: string;
    timestamp: number;
    email: string;
  };
  // Contrast-amplified image that surfaces the faint on-screen watermark text
  // so the recipient label can be read off a leaked screenshot.
  reveal?: string | null;
  // OCR'd watermark text and the best fuzzy match against the user's own shares.
  ocrText?: string;
  match?: ShareMatch | null;
}

export default function LeakInvestigator() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleExtract = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      // Calls the backend with the user's JWT; results are limited server-side
      // to watermarks belonging to this user's own shares.
      const data = await apiFetch<ExtractResult>('/api/admin/extract', {
        method: 'POST',
        auth: true,
        body: formData,
      });
      setResult(data);
    } catch {
      setResult({ found: false });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border rounded-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <Search className="w-6 h-6 text-primary" />
        <div>
          <h3 className="font-semibold">Leak Investigator</h3>
          <p className="text-sm text-zinc-500">Upload a leaked image to extract watermark data</p>
        </div>
      </div>
      <div className="flex gap-4 items-end">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="flex-1 text-sm"
        />
        <button
          onClick={handleExtract}
          disabled={!file || loading}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg disabled:opacity-50"
        >
          <Upload className="w-4 h-4" />
          {loading ? 'Analyzing...' : 'Extract'}
        </button>
      </div>
      {result && (
        <div className="mt-4 p-4 rounded-lg bg-zinc-50 space-y-4">
          {result.match ? (
            <div className="p-4 rounded-lg bg-green-50 border border-green-200">
              <p className="font-semibold text-green-800">
                Leak traced to: {result.match.recipientName}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-green-900">
                <span className="text-green-700">Recipient email</span>
                <span>{result.match.emailHint}</span>
                <span className="text-green-700">Shared as</span>
                <span>{result.match.type}</span>
                <span className="text-green-700">Created</span>
                <span>{new Date(result.match.createdAt).toLocaleString()}</span>
                <span className="text-green-700">Views</span>
                <span>{result.match.viewCount}</span>
                <span className="text-green-700">Match confidence</span>
                <span>{Math.round(result.match.confidence * 100)}%</span>
              </div>
              <p className="mt-2 text-xs text-green-700">
                Open this share in your list to see the full audit trail (precise location, device, time).
              </p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">
              Could not auto-match a recipient. Read the recipient label off the revealed image below.
            </p>
          )}

          {result.found && result.payload && (
            <div className="space-y-2 text-sm">
              <p className="font-medium text-green-700">Embedded watermark found ({result.method})</p>
              <pre className="text-xs overflow-x-auto">{JSON.stringify(result.payload, null, 2)}</pre>
            </div>
          )}

          {result.reveal && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Revealed on-screen watermark</p>
              <p className="text-xs text-zinc-500">
                Contrast-amplified to surface the faint diagonal label
                (recipient · share · time). Best on plain backgrounds.
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.reveal} alt="Revealed watermark" className="w-full rounded border bg-white" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
