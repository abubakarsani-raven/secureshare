'use client';

import { useState } from 'react';
import { FileText, Image, Video, Music, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import AuditLog from './AuditLog';
import RevokeButton from './RevokeButton';

interface Share {
  id: string;
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
  if (share.revoked) return { label: 'Revoked', color: 'bg-red-100 text-red-700' };
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
    return { label: 'Expired', color: 'bg-zinc-100 text-zinc-600' };
  }
  if (share.viewCount > 0) return { label: 'Viewed', color: 'bg-blue-100 text-blue-700' };
  return { label: 'Active', color: 'bg-green-100 text-green-700' };
}

export default function SharesList({
  shares,
  onRefresh,
}: {
  shares: Share[];
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (shares.length === 0) {
    return <p className="text-zinc-500 text-center py-8">No shares yet. Send your first secure file!</p>;
  }

  return (
    <div className="space-y-3">
      {shares.map((share) => {
        const status = getStatus(share);
        const isExpanded = expanded === share.id;
        return (
          <div key={share.id} className="border rounded-xl overflow-hidden bg-white">
            <div
              className="flex items-center gap-4 p-4 cursor-pointer hover:bg-zinc-50"
              onClick={() => setExpanded(isExpanded ? null : share.id)}
            >
              <div className="text-zinc-500">{typeIcons[share.type]}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{share.recipientName}</div>
                <div className="text-sm text-zinc-500">{share.emailHint}</div>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${status.color}`}>
                {status.label}
              </span>
              <span className="text-sm text-zinc-500">
                {share.viewCount}/{share.maxViews || '∞'} views
              </span>
              <span className="text-sm text-zinc-400 hidden sm:block">
                {new Date(share.createdAt).toLocaleDateString()}
              </span>
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
            {isExpanded && (
              <div className="border-t p-4 bg-zinc-50">
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
  );
}
