import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { ViewSessionProvider } from '@/context/ViewSessionContext';
import { ThemeProvider } from '@/context/ThemeContext';

export const metadata: Metadata = {
  title: 'SecureShare — Zero-Knowledge File Sharing',
  description: 'End-to-end encrypted file and message sharing via secure one-time links',
};

// Apply the saved theme before paint to avoid a light-mode flash on load.
const noFlashScript = `(function(){try{var t=localStorage.getItem('ss_theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <ViewSessionProvider>{children}</ViewSessionProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
