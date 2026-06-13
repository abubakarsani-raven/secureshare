import ShareForm from '@/components/send/ShareForm';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function SendMessagePage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-8 px-4">
      <div className="max-w-lg mx-auto">
        <Link href="/dashboard" className="flex items-center gap-2 text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </Link>
        <h1 className="text-2xl font-bold mb-6">Send secure message</h1>
        <ShareForm type="message" showSelfDestruct fileLabel="" />
      </div>
    </div>
  );
}
