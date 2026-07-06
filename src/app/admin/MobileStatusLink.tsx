'use client';

import { useRouter } from 'next/navigation';

// ⏱ 스크롤 속도 조절 — 숫자를 바꾸면 속도 변경 (ms)
// 예) 100 = 매우 빠름 / 200 = 빠름 / 400 = 보통 / 600 = 느림
const SCROLL_DURATION = 200;

function easeOutCubic(t: number) {
    return 1 - Math.pow(1 - t, 3);
}

function findScrollParent(element: HTMLElement) {
    let current: HTMLElement | null = element.parentElement;
    while (current) {
        const style = window.getComputedStyle(current);
        const canScroll = /(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight;
        if (canScroll) return current;
        current = current.parentElement;
    }
    return null;
}

function smoothScrollElement(container: HTMLElement | null, targetY: number, duration: number) {
    const startY = container ? container.scrollTop : window.scrollY;
    const diff = targetY - startY;
    if (Math.abs(diff) < 2) return;
    let startTime: number | null = null;

    function step(now: number) {
        if (!startTime) startTime = now;
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const nextY = startY + diff * easeOutCubic(progress);
        if (container) container.scrollTop = nextY;
        else window.scrollTo(0, nextY);
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function scrollToDashboardOrders() {
    const el = document.getElementById('dashboard-orders') ?? document.getElementById('mobile-orders');
    if (!el) return;
    const scrollParent = findScrollParent(el);
    if (scrollParent) {
        const targetTop = scrollParent.scrollTop + el.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top - 12;
        smoothScrollElement(scrollParent, Math.max(0, targetTop), SCROLL_DURATION);
        return;
    }
    const top = Math.max(0, el.getBoundingClientRect().top + window.scrollY - 72);
    smoothScrollElement(null, top, SCROLL_DURATION);
}

export default function MobileStatusLink({
    href,
    className,
    style,
    children,
}: {
    href: string;
    className: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}) {
    const router = useRouter();

    function handleClick(e: React.MouseEvent) {
        e.preventDefault();
        router.push(href, { scroll: false });
        requestAnimationFrame(() => requestAnimationFrame(scrollToDashboardOrders));
        window.setTimeout(scrollToDashboardOrders, 120);
        window.setTimeout(scrollToDashboardOrders, 300);
    }

    return (
        <a href={href} onClick={handleClick} className={className} style={style}>
            {children}
        </a>
    );
}
