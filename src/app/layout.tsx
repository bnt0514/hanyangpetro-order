import type { Metadata } from 'next';
import './globals.css';
import GlobalBackButton from '@/components/GlobalBackButton';

export const metadata: Metadata = {
  title: '한양유화 BNT OS',
  description: '한양유화 BNT 주문 관제 시스템',
  icons: { icon: '/hanyanglogo.png', apple: '/hanyanglogo.png' },
  manifest: '/manifest.json',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
        <GlobalBackButton />
      </body>
    </html>
  );
}
