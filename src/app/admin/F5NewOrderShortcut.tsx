'use client';

import { useF5NewOrderShortcut } from '@/hooks/useF5NewOrderShortcut';

/** F5 키 핸들러를 등록하는 클라이언트 컴포넌트 (렌더링 없음) */
export default function F5NewOrderShortcut() {
    useF5NewOrderShortcut();
    return null;
}
