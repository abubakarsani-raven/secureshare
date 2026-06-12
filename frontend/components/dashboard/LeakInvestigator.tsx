'use client';

import { useState } from 'react';
import { Search, Upload } from 'lucide-react';

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
      const res = await fetch('/api/admin/extract', { method: 'POST', body: formData });
      const data = await res.json();
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
        <div className="mt-4 p-4 rounded-lg bg-zinc-50">
          {result.found && result.payload ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium text-green-700">Watermark found ({result.method})</p>
              <pre className="text-xs overflow-x-auto">{JSON.stringify(result.payload, null, 2)}</pre>
            </div>
          ) : (
            <p className="text-zinc-500">No watermark found in this image.</p>
          )}
        </div>
      )}
    </div>
  );
}
