import ShareForm from '@/components/send/ShareForm';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function SendDocumentPage() {
  return (
    <div className="min-h-screen bg-zinc-50 py-8 px-4">
      <div className="max-w-lg mx-auto">
        <Link href="/dashboard" className="flex items-center gap-2 text-zinc-600 hover:text-zinc-900 mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </Link>
        <h1 className="text-2xl font-bold mb-6">Send secure document</h1>
        <ShareForm type="document" accept=".pdf,application/pdf" fileLabel="PDF file (max 50MB)" />
      </div>
    </div>
  );
}
