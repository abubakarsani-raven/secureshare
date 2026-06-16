'use client';

import { useEffect, useState } from 'react';
import { FileText, Image, Video, Music, MessageSquare, ChevronDown, ChevronUp, Users } from 'lucide-react';
import AuditLog from './AuditLog';
import RevokeButton from './RevokeButton';

interface Share {
  id: string;
  batchId: string | null;
  type: string;
  recipientName: string;
  emailHint: string;
  viewCount: number;
  maxViews: number;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
  lastViewedAt: string | null;
}

const typeIcons: Record<string, React.ReactNode> = {
  document: <FileText className="w-5 h-5" />,
  image: <Image className="w-5 h-5" />,
  video: <Video className="w-5 h-5" />,
  audio: <Music className="w-5 h-5" />,
  message: <MessageSquare className="w-5 h-5" />,
};

function getStatus(share: Share): { label: string; color: string } {
  if (share.revoked) return { label: 'Revoked', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' };
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
    return { label: 'Expired', color: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' };
  }
  if (share.viewCount > 0) return { label: 'Viewed', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' };
  return { label: 'Active', color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' };
}

interface Campaign {
  key: string;
  type: string;
  createdAt: string;
  shares: Share[];
}

// Groups per-recipient shares from the same upload into one campaign.
function groupCampaigns(shares: Share[]): Campaign[] {
  const map = new Map<string, Campaign>();
  for (const s of shares) {
    const key = s.batchId || s.id;
    const existing = map.get(key);
    if (existing) {
      existing.shares.push(s);
    } else {
      map.set(key, { key, type: s.type, createdAt: s.createdAt, shares: [s] });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export default function SharesList({
  shares,
  onRefresh,
  focusShareId,
}: {
  shares: Share[];
  onRefresh: () => void;
  focusShareId?: string | null;
}) {
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [expandedShare, setExpandedShare] = useState<string | null>(null);

  // The leak investigator can focus a share by id: expand its campaign + row so
  // the audit trail is visible, then scroll it into view.
  useEffect(() => {
    if (!focusShareId) return;
    const target = shares.find((s) => s.id === focusShareId);
    if (!target) return;
    setExpandedCampaign(target.batchId || target.id);
    setExpandedShare(focusShareId);
    // Defer until the expanded rows have rendered.
    const t = setTimeout(() => {
      document
        .querySelector(`[data-share-id="${focusShareId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
    return () => clearTimeout(t);
  }, [focusShareId, shares]);

  if (shares.length === 0) {
    return <p className="text-zinc-500 dark:text-zinc-400 text-center py-8">No shares yet. Send your first traceable file!</p>;
  }

  const campaigns = groupCampaigns(shares);

  return (
    <div className="space-y-3">
      {campaigns.map((c) => {
        const isOpen = expandedCampaign === c.key;
        const viewed = c.shares.filter((s) => s.viewCount > 0).length;
        const single = c.shares.length === 1;
        return (
          <div key={c.key} className="border rounded-xl overflow-hidden bg-white dark:bg-zinc-900 dark:border-zinc-800">
            <div
              className="flex items-center gap-4 p-4 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              onClick={() => setExpandedCampaign(isOpen ? null : c.key)}
            >
              <div className="text-zinc-500 dark:text-zinc-400">{typeIcons[c.type]}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium capitalize flex items-center gap-2">
                  {c.type}
                  {!single && (
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <Users className="w-3.5 h-3.5" /> {c.shares.length} recipients
                    </span>
                  )}
                </div>
                <div className="text-sm text-zinc-500 dark:text-zinc-400 truncate">
                  {single ? c.shares[0].recipientName : c.shares.map((s) => s.recipientName).join(', ')}
                </div>
              </div>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {viewed}/{c.shares.length} viewed
              </span>
              <span className="text-sm text-zinc-400 dark:text-zinc-500 hidden sm:block">
                {new Date(c.createdAt).toLocaleDateString()}
              </span>
              {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>

            {isOpen && (
              <div className="border-t dark:border-zinc-800 divide-y dark:divide-zinc-800">
                {c.shares.map((share) => {
                  const status = getStatus(share);
                  const open = expandedShare === share.id;
                  const focused = focusShareId === share.id;
                  return (
                    <div key={share.id} data-share-id={share.id}>
                      <div
                        className={`flex items-center gap-3 p-4 pl-6 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${
                          focused ? 'ring-2 ring-inset ring-green-400 dark:ring-green-600' : ''
                        }`}
                        onClick={() => setExpandedShare(open ? null : share.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{share.recipientName}</div>
                          <div className="text-sm text-zinc-500 dark:text-zinc-400 truncate">{share.emailHint}</div>
                        </div>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${status.color}`}>
                          {status.label}
                        </span>
                        <span className="text-sm text-zinc-500 dark:text-zinc-400">
                          {share.viewCount}/{share.maxViews || '∞'} views
                        </span>
                        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                      {open && (
                        <div className="border-t dark:border-zinc-800 p-4 bg-zinc-50 dark:bg-zinc-800/40">
                          <AuditLog shareId={share.id} />
                          <div className="flex gap-2 mt-4">
                            <RevokeButton shareId={share.id} revoked={share.revoked} onDone={onRefresh} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
