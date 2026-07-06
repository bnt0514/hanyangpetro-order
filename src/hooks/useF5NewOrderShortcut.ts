'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * F5 키를 누르면 신규 주문 등록 페이지로 이동합니다.
 * 기본 브라우저 새로고침(F5)을 막고 /admin/orders/new 로 라우팅합니다.
 */
export function useF5NewOrderShortcut() {
    const router = useRouter();

    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key !== 'F5' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
            const staffView = document.documentElement.dataset.staffView;
            const isMobileView = staffView === 'mobile' || (staffView !== 'desktop' && !window.matchMedia('(min-width: 768px)').matches);
            if (isMobileView) return;
            event.preventDefault();
            router.push('/admin/orders/new');
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [router]);
}
