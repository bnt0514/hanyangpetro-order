'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import AdminNav from './AdminNav';

const DRAWER_WIDTH = 300;
const OPEN_THRESHOLD = 60;

export default function MobileDrawerNav({
    isHanwhaManager,
    canManageCreditLimits,
    canViewAllStaffData,
}: {
    isHanwhaManager: boolean;
    canManageCreditLimits: boolean;
    canViewAllStaffData: boolean;
}) {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const [dragX, setDragX] = useState(0);
    const startXRef = useRef<number | null>(null);
    const isDraggingRef = useRef(false);

    function closeDrawer() {
        setOpen(false);
        setDragX(0);
    }

    function onTouchStart(e: React.TouchEvent) {
        startXRef.current = e.touches[0].clientX;
        isDraggingRef.current = false;
        setDragX(0);
    }

    function onTouchMove(e: React.TouchEvent) {
        if (startXRef.current === null) return;
        const dx = e.touches[0].clientX - startXRef.current;

        if (!open) {
            if (startXRef.current > 30 && !isDraggingRef.current) return;
            if (dx > 0) {
                isDraggingRef.current = true;
                setDragX(Math.min(dx, DRAWER_WIDTH));
            }
        } else if (dx < 0) {
            isDraggingRef.current = true;
            setDragX(Math.max(dx, -DRAWER_WIDTH));
        }
    }

    function onTouchEnd() {
        if (!isDraggingRef.current) {
            startXRef.current = null;
            return;
        }
        if (!open && dragX > OPEN_THRESHOLD) setOpen(true);
        else if (open && dragX < -OPEN_THRESHOLD) setOpen(false);
        setDragX(0);
        startXRef.current = null;
        isDraggingRef.current = false;
    }

    useEffect(() => {
        closeDrawer();
    }, [pathname]);

    useEffect(() => {
        let startX = 0;
        let active = false;

        function handleDocTouchStart(e: TouchEvent) {
            startX = e.touches[0].clientX;
            active = startX <= 30;
        }

        function handleDocTouchMove(e: TouchEvent) {
            if (!active || open) return;
            const dx = e.touches[0].clientX - startX;
            if (dx > 10) {
                setOpen(true);
                active = false;
            }
        }

        document.addEventListener('touchstart', handleDocTouchStart, { passive: true });
        document.addEventListener('touchmove', handleDocTouchMove, { passive: true });
        return () => {
            document.removeEventListener('touchstart', handleDocTouchStart);
            document.removeEventListener('touchmove', handleDocTouchMove);
        };
    }, [open]);

    const translateX = open
        ? Math.min(0, dragX)
        : Math.max(-DRAWER_WIDTH, dragX - DRAWER_WIDTH);

    return (
        <>
            {open && (
                <button
                    type="button"
                    className="fixed inset-0 z-40 cursor-default bg-black/30 backdrop-blur-sm"
                    onClick={closeDrawer}
                    aria-label="메뉴 닫기"
                />
            )}

            <div
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
                style={{
                    transform: `translateX(${translateX}px)`,
                    transition: isDraggingRef.current ? 'none' : 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
                    width: DRAWER_WIDTH,
                }}
                className="fixed left-0 top-0 z-50 flex h-full max-w-[86vw] flex-col bg-[#fff8f1] shadow-2xl"
            >
                <div className="flex h-12 items-center justify-between border-b border-orange-100 px-4">
                    <span className="text-sm font-bold text-slate-800">메뉴</span>
                    <button
                        type="button"
                        onClick={closeDrawer}
                        className="rounded-full p-1.5 text-slate-400 transition hover:bg-orange-50 hover:text-slate-700"
                        aria-label="메뉴 닫기"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-3">
                    <AdminNav
                        isHanwhaManager={isHanwhaManager}
                        canManageCreditLimits={canManageCreditLimits}
                        canViewAllStaffData={canViewAllStaffData}
                    />
                </div>

                <div className="border-t border-orange-100 px-4 py-2 text-center text-[10px] text-slate-400">
                    화면 왼쪽 끝에서 밀어도 메뉴가 열립니다.
                </div>
            </div>

            {!open && (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="fixed left-3 top-16 z-30 flex h-10 w-10 items-center justify-center rounded-xl border border-orange-200 bg-white text-orange-700 shadow-md"
                    aria-label="메뉴 열기"
                >
                    <Menu size={20} />
                </button>
            )}
        </>
    );
}
