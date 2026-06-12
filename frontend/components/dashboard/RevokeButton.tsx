'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Ban, Trash2 } from 'lucide-react';

export default function RevokeButton({
  shareId,
  revoked,
  onDone,
}: {
  shareId: string;
  revoked: boolean;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleRevoke = async () => {
    if (!confirm('Revoke this share? Recipients will no longer be able to access it.')) return;
    setLoading(true);
    try {
      await apiFetch(`/api/dashboard/shares/${shareId}/revoke`, { method: 'POST', auth: true });
      onDone();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Permanently delete this share and all associated files?')) return;
    setLoading(true);
    try {
      await apiFetch(`/api/dashboard/shares/${shareId}`, { method: 'DELETE', auth: true });
      onDone();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {!revoked && (
        <button
          onClick={handleRevoke}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 disabled:opacity-50"
        >
          <Ban className="w-4 h-4" /> Revoke
        </button>
      )}
      <button
        onClick={handleDelete}
        disabled={loading}
        className="flex items-center gap-2 px-3 py-2 text-sm bg-red-100 text-red-800 rounded-lg hover:bg-red-200 disabled:opacity-50"
      >
        <Trash2 className="w-4 h-4" /> Delete
      </button>
    </>
  );
}
