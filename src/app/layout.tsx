import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '한양유화 e-Business OS',
  description: '주식회사 한양유화 주문 관제 시스템',
  icons: { icon: '/hanyanglogo.png' },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}