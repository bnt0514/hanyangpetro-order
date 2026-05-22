'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function BackButton({ href }: { href: string }) {
    return (
        <Link
            href={href}
            title="상위 메뉴로"
            className="fixed bottom-6 right-6 z-50 flex items-center gap-1.5 rounded-full bg-slate-800/90 hover:bg-slate-900 text-white shadow-lg px-4 py-2.5 text-sm font-semibold backdrop-blur transition"
        >
            <ArrowLeft size={16} />
            뒤로
        </Link>
    );
}
