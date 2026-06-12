import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { ViewSessionProvider } from '@/context/ViewSessionContext';

export const metadata: Metadata = {
  title: 'SecureShare — Zero-Knowledge File Sharing',
  description: 'End-to-end encrypted file and message sharing via secure one-time links',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <ViewSessionProvider>{children}</ViewSessionProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
