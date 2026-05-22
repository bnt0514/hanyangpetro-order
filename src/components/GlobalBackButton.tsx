'use client';

import { usePathname } from 'next/navigation';
import BackButton from '@/components/BackButton';

function parentHref(pathname: string) {
    if (['/', '/login', '/admin', '/portal'].includes(pathname)) return null;

    if (pathname.startsWith('/portal/')) return '/portal';

    if (pathname.startsWith('/admin/customers/') && pathname.endsWith('/ledger')) {
        return pathname.replace(/\/ledger$/, '');
    }
    if (pathname.startsWith('/admin/customers/')) return '/admin/customers';
    if (pathname === '/admin/customers') return '/admin';

    if (pathname.startsWith('/admin/suppliers/')) return '/admin/suppliers';
    if (pathname === '/admin/suppliers') return '/admin';

    if (pathname.startsWith('/admin/')) return '/admin';

    return null;
}

export default function GlobalBackButton() {
    const pathname = usePathname();
    const href = parentHref(pathname);
    if (!href) return null;
    return <BackButton href={href} />;
}
