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
  reveal?: string | null;
  ocrText?: string;
  match?: ShareMatch | null;
  collusion?: {
    threshold: number;
    ranked: { recipientName: string; emailHint: string; shareId: string; score: number; accused: boolean }[];
  } | null;
}

function MatchCard({ match }: { match: ShareMatch }) {
  return (
    <div className="p-4 rounded-lg bg-green-50 border border-green-200 dark:bg-green-900/20 dark:border-green-800">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-green-800 dark:text-green-200">
          Leak traced to: {match.recipientName}
        </p>
        <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-green-200 text-green-900">
          {match.source === 'embedded'
            ? 'Embedded watermark · exact'
            : `On-screen watermark · ${Math.round(match.confidence * 100)}%`}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-green-900 dark:text-green-200">
        <span className="text-green-700 dark:text-green-400">Recipient email</span>
        <span>{match.emailHint}</span>
        <span className="text-green-700 dark:text-green-400">Shared as</span>
        <span>{match.type}</span>
        <span className="text-green-700 dark:text-green-400">Created</span>
        <span>{new Date(match.createdAt).toLocaleString()}</span>
        <span className="text-green-700 dark:text-green-400">Views</span>
        <span>{match.viewCount}</span>
      </div>
      <p className="mt-3 text-xs text-green-700 dark:text-green-400">
        Find this recipient in "Your shares" above to see the full audit trail —
        precise location, device, and time of every view.
      </p>
    </div>
  );
}

export default function LeakInvestigator() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualMatch, setManualMatch] = useState<ShareMatch | null | undefined>(undefined);
  const [manualLoading, setManualLoading] = useState(false);

  const handleExtract = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);
    setManualMatch(undefined);
    setManualQuery('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await apiFetch<ExtractResult>('/api/admin/extract', {
        method: 'POST',
        auth: true,
        body: formData,
      });
      setResult(data);
      // Pre-fill the manual search box with whatever the OCR pipeline extracted
      // so the user can see and correct it rather than reading the image cold.
      if (data.ocrText?.trim()) setManualQuery(data.ocrText.trim());
    } catch {
      setResult({ found: false });
    } finally {
      setLoading(false);
    }
  };

  const handleManualSearch = async () => {
    const q = manualQuery.trim();
    if (!q) return;
    setManualLoading(true);
    setManualMatch(undefined);
    try {
      const data = await apiFetch<{ match: ShareMatch | null }>(
        `/api/admin/search-shares?q=${encodeURIComponent(q)}`,
        { auth: true }
      );
      setManualMatch(data.match);
    } catch {
      setManualMatch(null);
    } finally {
      setManualLoading(false);
    }
  };

  const autoMatch = result?.match ?? null;
  const showManualSearch = result && !autoMatch && result.reveal;

  return (
    <div className="bg-white border rounded-xl p-6 dark:bg-zinc-900 dark:border-zinc-800">
      <div className="flex items-center gap-3 mb-4">
        <Search className="w-6 h-6 text-primary" />
        <div>
          <h3 className="font-semibold">Leak Investigator</h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Upload a leaked copy, screenshot, or video to identify which recipient it came from
          </p>
        </div>
      </div>
      <div className="flex gap-4 items-end">
        <input
          type="file"
          accept="image/*,video/*"
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
          {autoMatch ? (
            <MatchCard match={autoMatch} />
          ) : (
            <p className="text-sm text-zinc-500">
              Could not auto-identify a recipient. Read the name and code off the
              revealed image below and type it in the search box.
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
            <details open={!autoMatch}>
              <summary className="text-sm font-medium cursor-pointer text-zinc-600 hover:text-zinc-900 dark:text-zinc-300">
                {autoMatch ? 'Show revealed watermark image' : 'Revealed watermark — read the label below'}
              </summary>
              <p className="text-xs text-zinc-500 mt-2 mb-2">
                Contrast-amplified to surface the faint diagonal label (recipient · share id).
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.reveal} alt="Revealed watermark" className="w-full rounded border bg-white" />
              {result.ocrText?.trim() && (
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400 font-mono break-all">
                  OCR read: <span className="text-zinc-800 dark:text-zinc-200">{result.ocrText.trim()}</span>
                </p>
              )}
            </details>
          )}

          {showManualSearch && (
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800 space-y-2">
              <p className="text-xs font-medium text-blue-800 dark:text-blue-300">
                Type what you see in the image above — the recipient name, the short code, or both:
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualQuery}
                  onChange={(e) => setManualQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                  placeholder="e.g. Abubakar Sani  or  cLUWE5O4"
                  className="flex-1 text-sm px-3 py-1.5 rounded border border-blue-300 dark:border-blue-600 bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  onClick={handleManualSearch}
                  disabled={!manualQuery.trim() || manualLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-sm rounded disabled:opacity-50"
                >
                  <Search className="w-3.5 h-3.5" />
                  {manualLoading ? 'Searching…' : 'Search'}
                </button>
              </div>
              {manualMatch !== undefined && (
                manualMatch
                  ? <MatchCard match={manualMatch} />
                  : <p className="text-xs text-red-600 dark:text-red-400">No matching share found. Check the spelling or try just the short code.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
