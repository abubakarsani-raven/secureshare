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
  source: 'embedded' | 'ocr';
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
  // Collusion-secure (Tardos) accusation across the whole campaign.
  collusion?: {
    threshold: number;
    ranked: { recipientName: string; emailHint: string; shareId: string; score: number; accused: boolean }[];
  } | null;
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
    <div className="bg-white border rounded-xl p-6 dark:bg-zinc-900 dark:border-zinc-800">
      <div className="flex items-center gap-3 mb-4">
        <Search className="w-6 h-6 text-primary" />
        <div>
          <h3 className="font-semibold">Leak Investigator</h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Upload a leaked copy or screenshot to identify which recipient it came from
          </p>
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
        <div className="mt-4 p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 space-y-4">
          {result.match ? (
            <div className="p-4 rounded-lg bg-green-50 border border-green-200 dark:bg-green-900/20 dark:border-green-800">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-green-800">
                  Leak traced to: {result.match.recipientName}
                </p>
                <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-green-200 text-green-900">
                  {result.match.source === 'embedded'
                    ? 'Embedded watermark · exact'
                    : `On-screen watermark · ${Math.round(result.match.confidence * 100)}%`}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-green-900">
                <span className="text-green-700">Recipient email</span>
                <span>{result.match.emailHint}</span>
                <span className="text-green-700">Shared as</span>
                <span>{result.match.type}</span>
                <span className="text-green-700">Created</span>
                <span>{new Date(result.match.createdAt).toLocaleString()}</span>
                <span className="text-green-700">Views</span>
                <span>{result.match.viewCount}</span>
              </div>
              <p className="mt-3 text-xs text-green-700">
                Find this recipient in “Your shares” above to see the full audit trail —
                precise location, device, and time of every view.
              </p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">
              Could not auto-identify a recipient. If you uploaded a screenshot, read the recipient
              label off the revealed image below; embedded watermarks need the original file (not a
              screenshot).
            </p>
          )}

          {result.collusion && result.collusion.ranked.length > 1 && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
              <div className="px-3 py-2 bg-zinc-100 dark:bg-zinc-800 text-sm font-medium">
                Collusion-secure fingerprint scores
                <span className="ml-1 font-normal text-zinc-500 dark:text-zinc-400">
                  (accuse above {Math.round(result.collusion.threshold)})
                </span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {result.collusion.ranked.slice(0, 6).map((r) => (
                    <tr key={r.shareId} className="border-t dark:border-zinc-700">
                      <td className="px-3 py-1.5">{r.recipientName}</td>
                      <td className="px-3 py-1.5 text-zinc-500 dark:text-zinc-400">{r.emailHint}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{Math.round(r.score)}</td>
                      <td className="px-3 py-1.5 text-right">
                        {r.accused && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                            implicated
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                Scores hold up even if recipients colluded to splice a mixed copy — at least one true
                leaker still scores above the threshold.
              </p>
            </div>
          )}

          {result.reveal && (
            <details className="group">
              <summary className="text-sm font-medium cursor-pointer text-zinc-600 hover:text-zinc-900">
                Show revealed watermark image
              </summary>
              <p className="text-xs text-zinc-500 mt-2 mb-2">
                Contrast-amplified to surface the faint diagonal label (recipient · share id).
                Best on plain backgrounds.
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.reveal} alt="Revealed watermark" className="w-full rounded border bg-white" />
            </details>
          )}
        </div>
      )}
    </div>
  );
}
