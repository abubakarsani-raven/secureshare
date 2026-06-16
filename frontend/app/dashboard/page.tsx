'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import SharesList from '@/components/dashboard/SharesList';
import LeakInvestigator from '@/components/dashboard/LeakInvestigator';
import ThemeToggle from '@/components/ThemeToggle';
import { Shield, LogOut, FileText, Image, Video, Music, MessageSquare, HelpCircle } from 'lucide-react';

interface Stats {
  totalShares: number;
  totalViews: number;
  activeShares: number;
  revokedShares: number;
}

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

export default function DashboardPage() {
  const { user, logout, isLoading } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  // When the leak investigator traces a leak, jump to that share's audit trail.
  const [focusShareId, setFocusShareId] = useState<string | null>(null);

  const load = () => {
    apiFetch<Stats>('/api/dashboard/stats', { auth: true }).then(setStats).catch(console.error);
    apiFetch<Share[]>('/api/dashboard/shares', { auth: true }).then(setShares).catch(console.error);
  };

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [user, isLoading, router]);

  useEffect(() => {
    if (user) load();
  }, [user]);

  if (isLoading || !user) return null;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <nav className="border-b bg-white dark:bg-zinc-900 dark:border-zinc-800">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2 font-bold text-xl">
            <Shield className="w-6 h-6 text-primary" /> SecureShare
          </Link>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Link href="/help" className="flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white">
              <HelpCircle className="w-4 h-4" /> Help
            </Link>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">{user.email}</span>
            <button onClick={logout} className="flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white">
              <LogOut className="w-4 h-4" /> Logout
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-wrap gap-4 mb-8">
          {[
            { href: '/send/document', icon: FileText, label: 'Document' },
            { href: '/send/image', icon: Image, label: 'Image' },
            { href: '/send/video', icon: Video, label: 'Video' },
            { href: '/send/audio', icon: Music, label: 'Audio' },
            { href: '/send/message', icon: MessageSquare, label: 'Message' },
          ].map(({ href, icon: Icon, label }) => (
            <Link key={href} href={href} className="flex items-center gap-2 px-4 py-2 bg-white border rounded-lg hover:border-primary hover:text-primary dark:bg-zinc-900 dark:border-zinc-800 dark:hover:border-primary">
              <Icon className="w-4 h-4" /> {label}
            </Link>
          ))}
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Total Sent', value: stats.totalShares },
              { label: 'Total Views', value: stats.totalViews },
              { label: 'Active Links', value: stats.activeShares },
              { label: 'Revoked', value: stats.revokedShares },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white p-4 rounded-xl border dark:bg-zinc-900 dark:border-zinc-800">
                <div className="text-2xl font-bold">{value}</div>
                <div className="text-sm text-zinc-500 dark:text-zinc-400">{label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-white border rounded-xl p-6 mb-8 dark:bg-zinc-900 dark:border-zinc-800">
          <h2 className="font-semibold text-lg mb-4">Your shares</h2>
          <SharesList shares={shares} onRefresh={load} focusShareId={focusShareId} />
        </div>

        <LeakInvestigator onViewAuditTrail={setFocusShareId} />
      </div>
    </div>
  );
}
