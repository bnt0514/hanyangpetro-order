'use client';

import { useEffect, useRef, useState } from 'react';
import AdminNav from './AdminNav';

export default function MobileDrawerNav({
    isHanwhaManager,
    canManageCreditLimits,
    canViewAllStaffData,
}: {
    isHanwhaManager: boolean;
    canManageCreditLimits: boolean;
    canViewAllStaffData: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [dragX, setDragX] = useState(0); // pixels dragged (positive = open direction)
    const drawerRef = useRef<HTMLDivElement>(null);
    const startXRef = useRef<number | null>(null);
    const isDraggingRef = useRef(false);
    const DRAWER_WIDTH = 300;
    const OPEN_THRESHOLD = 60;

    // Touch start
    function onTouchStart(e: React.TouchEvent) {
        startXRef.current = e.touches[0].clientX;
        isDraggingRef.current = false;
        setDragX(0);
    }

    function onTouchMove(e: React.TouchEvent) {
        if (startXRef.current === null) return;
        const dx = e.touches[0].clientX - startXRef.current;

        if (!open) {
            // Only open via left-edge swipe (start within 30px of left)
            if (startXRef.current > 30 && !isDraggingRef.current) return;
            if (dx > 0) {
                isDraggingRef.current = true;
                setDragX(Math.min(dx, DRAWER_WIDTH));
            }
        } else {
            // Close via right-to-left drag
            if (dx < 0) {
                isDraggingRef.current = true;
                setDragX(Math.max(dx, -DRAWER_WIDTH));
            }
        }
    }

    function onTouchEnd() {
        if (!isDraggingRef.current) {
            startXRef.current = null;
            return;
        }
        if (!open && dragX > OPEN_THRESHOLD) {
            setOpen(true);
        } else if (open && dragX < -OPEN_THRESHOLD) {
            setOpen(false);
        }
        setDragX(0);
        startXRef.current = null;
        isDraggingRef.current = false;
    }

    // Close on overlay click
    function closeDrawer() {
        setOpen(false);
        setDragX(0);
    }

    // Compute translate
    const translateX = open
        ? Math.min(0, dragX) // when open, drag left to close
        : Math.max(-DRAWER_WIDTH, dragX - DRAWER_WIDTH); // when closed, start off-screen

    // Add document-level touch handlers for the edge-pull gesture
    useEffect(() => {
        let startX = 0;
        let active = false;

        function handleDocTouchStart(e: TouchEvent) {
            startX = e.touches[0].clientX;
            active = startX <= 30; // left edge zone
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

    return (
        <>
            {/* Overlay */}
            {open && (
                <div
                    className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
                    onClick={closeDrawer}
                />
            )}

            {/* Drawer */}
            <div
                ref={drawerRef}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
                style={{
                    transform: `translateX(${translateX}px)`,
                    transition: isDraggingRef.current ? 'none' : 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
                    width: DRAWER_WIDTH,
                }}
                className="fixed left-0 top-0 z-50 flex h-full flex-col bg-[#fff8f1] shadow-2xl"
            >
                {/* Drawer header */}
                <div className="flex items-center justify-between border-b border-orange-100 px-4 py-3">
                    <span className="text-sm font-bold text-slate-800">메뉴</span>
                    <button
                        type="button"
                        onClick={closeDrawer}
                        className="rounded-full p-1.5 text-slate-400 hover:bg-orange-50 hover:text-slate-700 transition"
                        aria-label="메뉴 닫기"
                    >
                        ✕
                    </button>
                </div>

                {/* Nav content */}
                <div className="flex-1 overflow-y-auto p-3">
                    <AdminNav
                        isHanwhaManager={isHanwhaManager}
                        canManageCreditLimits={canManageCreditLimits}
                        canViewAllStaffData={canViewAllStaffData}
                    />
                </div>

                {/* Drag handle hint */}
                <div className="border-t border-orange-100 px-4 py-2 text-center text-[10px] text-slate-400">
                    왼쪽 화면 끝에서 오른쪽으로 스와이프하면 메뉴가 열립니다
                </div>
            </div>

            {/* Hamburger open button */}
            {!open && (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="fixed left-3 top-1/2 z-30 -translate-y-1/2 flex h-8 w-5 flex-col items-center justify-center gap-1 rounded-r-lg border border-l-0 border-orange-200 bg-white shadow-md"
                    aria-label="메뉴 열기"
                >
                    <span className="h-0.5 w-3 rounded bg-orange-400" />
                    <span className="h-0.5 w-3 rounded bg-orange-400" />
                    <span className="h-0.5 w-3 rounded bg-orange-400" />
                </button>
            )}
        </>
    );
}
