import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import GlobalBackButton from '@/components/GlobalBackButton';

export const metadata: Metadata = {
  title: '한양유화 BNT OS',
  description: '한양유화 BNT 주문 관제 시스템',
  icons: { icon: '/hanyanglogo.png', apple: '/hanyanglogo.png' },
  manifest: '/manifest.json',
};

const staffViewInitScript = `
try {
  var key = 'hanyang-staff-view-mode';
  var stored = window.localStorage.getItem(key);
  var mode = stored === 'desktop' || stored === 'mobile'
    ? stored
    : (window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop');
  document.documentElement.dataset.staffView = mode;
} catch (e) {}
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <Script
        id="staff-view-mode-init"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{ __html: staffViewInitScript }}
      />
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
        <GlobalBackButton />
      </body>
    </html>
  );
}
