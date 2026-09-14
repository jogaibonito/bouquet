import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Bouquet',
  description: 'Share photos from the day. No app, no account.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
