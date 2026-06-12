import Link from 'next/link';
import { Shield, Lock, Eye, FileText, Zap } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <nav className="border-b bg-white/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-xl">
            <Shield className="w-7 h-7 text-primary" />
            SecureShare
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/help" className="text-zinc-600 hover:text-zinc-900">How it works</Link>
            <Link href="/login" className="text-zinc-600 hover:text-zinc-900">Login</Link>
            <Link href="/register" className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      <section className="max-w-6xl mx-auto px-4 py-20 text-center">
        <h1 className="text-5xl font-bold tracking-tight mb-6">
          Share files securely.<br />
          <span className="text-primary">Zero knowledge. Full control.</span>
        </h1>
        <p className="text-xl text-zinc-600 max-w-2xl mx-auto mb-10">
          End-to-end encrypted sharing for PDFs, images, videos, audio, and messages.
          One-time links with OTP verification, forensic watermarks, and complete audit trails.
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/register" className="px-8 py-3 bg-primary text-white rounded-lg text-lg font-medium hover:bg-primary-dark">
            Start sharing securely
          </Link>
          <Link href="/login" className="px-8 py-3 border rounded-lg text-lg font-medium hover:bg-zinc-50">
            Sign in
          </Link>
        </div>
      </section>

      <section className="bg-zinc-50 py-20">
        <div className="max-w-6xl mx-auto px-4 grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {[
            { icon: Lock, title: 'Zero-Knowledge', desc: 'Messages encrypted client-side. Server never sees plaintext.' },
            { icon: Eye, title: 'Forensic Watermarks', desc: 'DCT, LSB, and audio steganography trace leaks to recipients.' },
            { icon: FileText, title: 'Secure Viewers', desc: 'Canvas-only rendering blocks screenshots and downloads.' },
            { icon: Zap, title: 'One-Time Links', desc: 'Expiring links with view limits and instant revocation.' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="bg-white p-6 rounded-xl border">
              <Icon className="w-10 h-10 text-primary mb-4" />
              <h3 className="font-semibold text-lg mb-2">{title}</h3>
              <p className="text-zinc-600 text-sm">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t py-8 text-center text-zinc-500 text-sm">
        SecureShare — Production-grade secure file sharing platform
      </footer>
    </div>
  );
}
