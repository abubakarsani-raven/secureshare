'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

interface AuditEntry {
  id: string;
  event: string;
  ip_address: string;
  country: string;
  city: string;
  device: string;
  browser: string;
  os: string;
  latitude: number | null;
  longitude: number | null;
  geo_accuracy: number | null;
  timestamp: string;
}

export default function AuditLog({ shareId }: { shareId: string }) {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<AuditEntry[]>(`/api/dashboard/shares/${shareId}/audit`, { auth: true })
      .then(setLogs)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [shareId]);

  if (loading) return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading audit log...</p>;
  if (logs.length === 0) return <p className="text-sm text-zinc-500 dark:text-zinc-400">No activity recorded.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-zinc-500 dark:text-zinc-400 border-b dark:border-zinc-700">
            <th className="pb-2 pr-4">Event</th>
            <th className="pb-2 pr-4">Location (IP)</th>
            <th className="pb-2 pr-4">Precise location</th>
            <th className="pb-2 pr-4">Device</th>
            <th className="pb-2">Time</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-b border-zinc-100 dark:border-zinc-800">
              <td className="py-2 pr-4 font-medium">{log.event}</td>
              <td className="py-2 pr-4">{log.city}, {log.country}</td>
              <td className="py-2 pr-4">
                {log.latitude != null && log.longitude != null ? (
                  <a
                    href={`https://www.google.com/maps?q=${log.latitude},${log.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {log.latitude.toFixed(5)}, {log.longitude.toFixed(5)}
                    {log.geo_accuracy != null && (
                      <span className="text-zinc-400"> (±{Math.round(log.geo_accuracy)}m)</span>
                    )}
                  </a>
                ) : (
                  <span className="text-zinc-400">—</span>
                )}
              </td>
              <td className="py-2 pr-4">{log.browser} / {log.os}</td>
              <td className="py-2">{new Date(log.timestamp).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
