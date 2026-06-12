import Link from 'next/link';
import {
  Shield,
  UserPlus,
  Upload,
  Settings2,
  Send,
  Inbox,
  LayoutDashboard,
  Search,
  HelpCircle,
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  MessageSquare,
  AlertTriangle,
} from 'lucide-react';

export const metadata = {
  title: 'How to use SecureShare',
  description: 'Step-by-step tutorial for sending and receiving secure shares.',
};

const steps = [
  { id: 'account', icon: UserPlus, title: '1. Create your account' },
  { id: 'send', icon: Upload, title: '2. Send something securely' },
  { id: 'options', icon: Settings2, title: '3. Choose your security options' },
  { id: 'deliver', icon: Send, title: '4. Deliver the link' },
  { id: 'recipient', icon: Inbox, title: '5. What your recipient sees' },
  { id: 'manage', icon: LayoutDashboard, title: '6. Track, revoke, and audit' },
  { id: 'leaks', icon: Search, title: '7. Investigate a leak' },
  { id: 'faq', icon: HelpCircle, title: 'FAQ & troubleshooting' },
];

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <nav className="border-b bg-white/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-xl">
            <Shield className="w-7 h-7 text-primary" />
            SecureShare
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-zinc-600 hover:text-zinc-900">Login</Link>
            <Link href="/dashboard" className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark">
              Dashboard
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold tracking-tight mb-3">How to use SecureShare</h1>
        <p className="text-lg text-zinc-600 mb-8">
          A five-minute guide to sending files and messages that only the right person can open —
          and proving it if they ever leak.
        </p>

        {/* Table of contents */}
        <div className="bg-white border rounded-xl p-5 mb-12">
          <h2 className="font-semibold mb-3">In this guide</h2>
          <ul className="grid sm:grid-cols-2 gap-2">
            {steps.map(({ id, icon: Icon, title }) => (
              <li key={id}>
                <a href={`#${id}`} className="flex items-center gap-2 text-sm text-zinc-600 hover:text-primary">
                  <Icon className="w-4 h-4 shrink-0" /> {title}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-12">
          {/* 1. Account */}
          <section id="account" className="scroll-mt-24">
            <h2 className="flex items-center gap-2 text-2xl font-bold mb-4">
              <UserPlus className="w-6 h-6 text-primary" /> 1. Create your account
            </h2>
            <ol className="list-decimal list-inside space-y-2 text-zinc-700">
              <li>
                Go to <Link href="/register" className="text-primary underline">Register</Link> and enter your
                email and a strong password (at least 8 characters with an uppercase letter, a number, and a symbol).
              </li>
              <li>
                After registering you get a <strong>two-factor (2FA) QR code</strong>. Scan it with an authenticator
                app like Google Authenticator or Authy. From then on, logging in asks for your password plus the
                6-digit code from the app.
              </li>
              <li>You land on the dashboard — this is your home base for everything below.</li>
            </ol>
            <p className="mt-3 text-sm text-zinc-500">
              Only <em>senders</em> need an account. The people you share with never register or install anything —
              they just open a link in their browser, on any phone or computer.
            </p>
          </section>

          {/* 2. Send */}
          <section id="send" className="scroll-mt-24">
            <h2 className="flex items-center gap-2 text-2xl font-bold mb-4">
              <Upload className="w-6 h-6 text-primary" /> 2. Send something securely
            </h2>
            <p className="text-zinc-700 mb-4">
              From the dashboard, pick what you want to share. Each type has its own secure pipeline:
            </p>
            <div className="space-y-3">
              {[
                {
                  icon: FileText,
                  title: 'Document (PDF, up to 50 MB)',
                  desc: 'Every page is converted to a watermarked image on the server. The recipient views pages one at a time — the original PDF is destroyed after processing and can never be downloaded.',
                },
                {
                  icon: ImageIcon,
                  title: 'Image (JPG, PNG, WEBP, GIF, up to 20 MB)',
                  desc: 'Location data (EXIF) is stripped, the image is re-encoded, and two invisible watermarks are embedded that identify the recipient.',
                },
                {
                  icon: Video,
                  title: 'Video (MP4, MOV, WEBM, up to 500 MB)',
                  desc: 'Converted to encrypted streaming segments with a faint session watermark burned into frames. Plays in a protected player — no download button, no casting.',
                },
                {
                  icon: Music,
                  title: 'Audio (MP3, WAV, M4A, OGG, up to 100 MB)',
                  desc: 'Transcoded into encrypted 30-second chunks with an inaudible watermark hidden in the sound itself.',
                },
                {
                  icon: MessageSquare,
                  title: 'Message (text, up to 10,000 characters)',
                  desc: 'Encrypted in your browser before it leaves your device. The server only ever stores scrambled data it cannot read — true zero-knowledge.',
                },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex gap-3 bg-white border rounded-xl p-4">
                  <Icon className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium">{title}</div>
                    <p className="text-sm text-zinc-600">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-zinc-700">
              In the form, enter the <strong>recipient&apos;s name</strong> and their <strong>email address</strong>.
              The email matters: it is the identity check — only someone who controls that inbox will be able to open
              the share. It is stored only as an irreversible hash, never in plain text.
            </p>
          </section>

          {/* 3. Options */}
          <section id="options" className="scroll-mt-24">
            <h2 className="flex items-center gap-2 text-2xl font-bold mb-4">
              <Settings2 className="w-6 h-6 text-primary" /> 3. Choose your security options
            </h2>
            <div className="bg-white border rounded-xl divide-y">
              {[
                {
                  name: 'Expiry',
                  desc: 'How long the link stays alive: 1 hour to 7 days, or never. After expiry the link shows "This link has expired" no matter who opens it. Default: 24 hours.',
                },
                {
                  name: 'Max views',
                  desc: 'How many times the content can be opened: 1, 3, 5, 10, or unlimited. A "1" makes it a true one-time link — once viewed, it is dead. Default: 1.',
                },
                {
                  name: 'Require OTP verification',
                  desc: 'When on (recommended), the recipient must type their email and enter a 6-digit code sent to that inbox before anything is shown. This is what stops a forwarded link from being opened by the wrong person.',
                },
                {
                  name: 'Self-destruct (messages only)',
                  desc: 'A countdown that starts when the message is opened: 10 seconds to 5 minutes. When it hits zero the message wipes itself from the screen and the server, permanently.',
                },
              ].map(({ name, desc }) => (
                <div key={name} className="p-4">
                  <div className="font-medium">{name}</div>
                  <p className="text-sm text-zinc-600">{desc}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-zinc-500">
              Rule of thumb: for anything sensitive, keep the defaults — 1 view, 24-hour expiry, OTP on.
            </p>
          </section>

          {/* 4. Deliver */}
          <section id="deliver" className="scroll-mt-24">
            <h2 className="flex items-center gap-2 text-2xl font-bold mb-4">
              <Send className="w-6 h-6 text-primary" /> 4. Deliver the link
            </h2>
            <p className="text-zinc-700 mb-3">
              After upload you get a unique link, a QR code, and share buttons for WhatsApp and email.
              Send the link however you like — the link alone is not enough to open the content when OTP
              is on, so an intercepted link is useless to a stranger.
            </p>
            <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                <strong>For messages:</strong> copy the link exactly as shown. The part after the{' '}
                <code className="bg-amber-100 px-1 rounded">#</code> symbol contains a decryption key that never
                touches our server — if it gets cut off, the message cannot be decrypted by anyone, including us.
                The copy button always copies the full link, so prefer it over selecting the text by hand.
              </p>
            </div>
          </section>

          {/* 5. Recipient */}
          <section id="recipient" className="scroll-mt-24">
            <h2 className="flex items-center gap-2 text-2xl font-bold mb-4">
              <Inbox className="w-6 h-6 text-primary" /> 5. What your recipient sees
            </h2>
            <ol className="list-decimal list-inside space-y-2 text-zinc-700">
              <li>They open the link in any browser — phone, tablet, or computer. Nothing to install.</li>
              <li>They type their email address. It must match the one you entered when creating the share.</li>
              <li>A 6-digit verification code arrives in their inbox (valid for 10 minutes, 3 attempts max).</li>
              <li>After entering the code, the content appears in a protected viewer.</li>
            </ol>
            <p className="mt-4 text-zinc-700 mb-3">While viewing, the protections are active:</p>
            <ul className="list-disc list-inside space-y-1 text-zinc-600 text-sm">
              <li>No download or save button exists; right-click, copy, print, and save shortcuts are blocked</li>
              <li>Content blurs instantly when the window loses focus or is switched away from</li>
              <li>Opening browser developer tools hides the content</li>
              <li>Everything is drawn on a protected canvas — there is no image or file in the page to grab</li>
              <li>Every view is invisibly watermarked with the recipient&apos;s identity</li>
            </ul>
            <p className="mt-3 text-sm text-zinc-500">
              Be straight with yourself about the limits: nothing can stop someone pointing a second phone camera
              at their screen. That is exactly what the watermarks are for — see section 7.
            </p>
          </section>

          {/* 6. Manage */}
          <section id="manage" className="scroll-mt-24">
            <h2 className="flex items-center gap-2 text-2xl font-bold mb-4">
              <LayoutDashboard className="w-6 h-6 text-primary" /> 6. Track, revoke, and audit
            </h2>
            <p className="text-zinc-700 mb-3">
              Your <Link href="/dashboard" className="text-primary underline">dashboard</Link> lists every share with
              its status (active, viewed, expired, revoked) and view count. Expand any share to see its full
              <strong> audit log</strong>: every time a code was sent, verified, and the content was viewed — with
              time, approximate location, device, and browser.
            </p>
            <ul className="list-disc list-inside space-y-1 text-zinc-700">
              <li>
                <strong>Revoke</strong> — kills the link immediately, even if it has views left. Use this the moment
                something feels wrong. It cannot be undone.
              </li>
              <li>
                <strong>Delete</strong> — removes the share and all its encrypted files from storage permanently.
              </li>
            </ul>
          </section>

          {/* 7. Leaks */}
          <section id="leaks" className="scroll-mt-24">
            <h2 className="flex items-center gap-2 text-2xl font-bold mb-4">
              <Search className="w-6 h-6 text-primary" /> 7. Investigate a leak
            </h2>
            <p className="text-zinc-700 mb-3">
              Suppose a document page or image you shared shows up somewhere it should not — forwarded, posted,
              or screenshotted. Scroll to the <strong>Leak Investigator</strong> at the bottom of the dashboard and
              upload the leaked image. SecureShare scans it for the invisible watermarks embedded at share time.
            </p>
            <p className="text-zinc-700">
              If a watermark is found, you get back the share it came from and the recipient identity it was
              watermarked for — evidence of <em>whose copy</em> leaked. Two independent watermark techniques are
              embedded in every image (one hidden in pixel data, one in the image&apos;s frequency patterns), so the
              mark can survive even after re-saving.
            </p>
          </section>

          {/* FAQ */}
          <section id="faq" className="scroll-mt-24">
            <h2 className="flex items-center gap-2 text-2xl font-bold mb-4">
              <HelpCircle className="w-6 h-6 text-primary" /> FAQ &amp; troubleshooting
            </h2>
            <div className="space-y-4">
              {[
                {
                  q: 'My recipient says the verification email never arrived.',
                  a: 'Ask them to check spam, and confirm the email they typed is exactly the one you used when creating the share — a different address is rejected without explanation, by design. Codes can be re-requested up to 3 times per hour per link.',
                },
                {
                  q: 'The link says "locked" after failed attempts.',
                  a: 'Three wrong codes lock that link permanently as an anti-guessing measure. Create a new share for your recipient.',
                },
                {
                  q: 'A message says "Missing encryption keys".',
                  a: 'The link was truncated — the secret part after the # symbol is missing. Re-send the full link using the copy button. The server cannot recover the message without it; that is the zero-knowledge guarantee working as intended.',
                },
                {
                  q: 'Can I see whether my file was actually opened?',
                  a: 'Yes — the view count on the dashboard and the audit log show every view with time, location, and device.',
                },
                {
                  q: 'Can SecureShare staff read my messages?',
                  a: 'No. Messages are encrypted in your browser, and one of the three key pieces needed to decrypt them lives only in the link itself and is never sent to the server.',
                },
                {
                  q: 'I shared something by mistake. What do I do?',
                  a: 'Open the dashboard and hit Revoke on that share — the link dies instantly, even if it was never opened. Then Delete to purge the files.',
                },
              ].map(({ q, a }) => (
                <div key={q} className="bg-white border rounded-xl p-4">
                  <div className="font-medium mb-1">{q}</div>
                  <p className="text-sm text-zinc-600">{a}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="mt-14 text-center">
          <Link
            href="/register"
            className="inline-block px-8 py-3 bg-primary text-white rounded-lg text-lg font-medium hover:bg-primary-dark"
          >
            Start sharing securely
          </Link>
        </div>
      </div>

      <footer className="border-t py-8 text-center text-zinc-500 text-sm bg-white">
        SecureShare — Production-grade secure file sharing platform
      </footer>
    </div>
  );
}
