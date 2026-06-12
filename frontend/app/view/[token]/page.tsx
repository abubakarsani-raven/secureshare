'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import OTPGate from '@/components/security/OTPGate';
import SecureDocViewer from '@/components/viewers/SecureDocViewer';
import SecureImageViewer from '@/components/viewers/SecureImageViewer';
import SecureVideoPlayer from '@/components/viewers/SecureVideoPlayer';
import SecureAudioPlayer from '@/components/viewers/SecureAudioPlayer';
import SecureMessageViewer from '@/components/viewers/SecureMessageViewer';
import { Shield, AlertTriangle } from 'lucide-react';

interface PublicInfo {
  type: string;
  recipientName: string;
  otpRequired: boolean;
  accessible: boolean;
  reason: string | null;
}

interface ShareInfo {
  type: string;
  pageCount: number | null;
  duration: number | null;
  chunkCount: number | null;
  selfDestructSeconds: number | null;
}

export default function ViewPage() {
  const params = useParams();
  const token = params.token as string;
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    apiFetch<PublicInfo>(`/api/view/${token}/public-info`)
      .then(setInfo)
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
  }, [token]);

  // /info consumes a view, so it is fetched exactly once per session here and
  // its metadata is passed down — viewers must not re-fetch it themselves.
  useEffect(() => {
    if (verified) {
      apiFetch<ShareInfo>(`/api/view/${token}/info`, { viewSession: true })
        .then(setShareInfo)
        .catch(console.error);
    }
  }, [verified, token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-zinc-500">Loading...</div>
      </div>
    );
  }

  if (!info || !info.accessible) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center p-8 bg-white rounded-xl shadow-lg border max-w-md">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Link unavailable</h1>
          <p className="text-zinc-600">
            {info?.reason === 'expired' && 'This link has expired.'}
            {info?.reason === 'revoked' && 'This link has been revoked.'}
            {info?.reason === 'max_views' && 'Maximum view limit reached.'}
            {info?.reason === 'destroyed' && 'This content has been destroyed.'}
            {!info && 'Share not found.'}
          </p>
        </div>
      </div>
    );
  }

  const viewers: Record<string, React.ReactNode> = {
    document: <SecureDocViewer token={token} pageCount={shareInfo?.pageCount || 0} />,
    image: <SecureImageViewer token={token} />,
    video: <SecureVideoPlayer token={token} />,
    audio: <SecureAudioPlayer token={token} chunkCount={shareInfo?.chunkCount || 0} />,
    message: (
      <SecureMessageViewer token={token} selfDestructSeconds={shareInfo?.selfDestructSeconds ?? null} />
    ),
  };

  return (
    <div className="min-h-screen bg-zinc-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <Shield className="w-6 h-6 text-primary" />
          <span className="font-semibold">SecureShare</span>
          <span className="text-zinc-400">|</span>
          <span className="text-zinc-600">For {info.recipientName}</span>
        </div>

        <OTPGate token={token} otpRequired={info.otpRequired} onVerified={() => setVerified(true)}>
          {viewers[info.type]}
        </OTPGate>
      </div>
    </div>
  );
}
