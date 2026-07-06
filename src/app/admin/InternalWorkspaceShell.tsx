'use client';

/* eslint-disable react-hooks/set-state-in-effect */

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Home, X } from 'lucide-react';

type WorkspaceTab = {
    key: string;
    href: string;
    label: string;
    fixed?: boolean;
};

const HOME_TAB: WorkspaceTab = {
    key: '/admin',
    href: '/admin',
    label: '메인',
    fixed: true,
};

const MENU_TITLES: Record<string, string> = {
    '/admin': '메인',
    '/admin/orders/new': '오더 등록',
    '/admin/orders/sheet-reconcile': '매입매출 오더 대조',
    '/admin/dispatch': '배차 조회',
    '/admin/settings/hanwha': '한화 비번',
    '/admin/orders/deleted': '삭제된 주문',
    '/admin/customers': '거래처 관리',
    '/admin/reports/customer-patterns': '거래처 패턴',
    '/admin/credit-overrides': '여신 초과 승인',
    '/admin/credit-limits': '여신 한도 관리',
    '/admin/ledger': '원장 통합조회',
    '/admin/finance-transactions': '입출금 등록',
    '/admin/collections': '수금 대조',
    '/admin/ledger/manual-entry': '수기 원장 입력',
    '/admin/warehouse': '창고 재고',
    '/admin/products': '품목 관리',
    '/admin/prices': '단가 관리',
    '/admin/reports/sales-daily': '매입매출 조회',
    '/admin/reports/performance': '기간별 매입매출',
    '/admin/reports/profit': '수익 분석',
    '/admin/customers/import': '거래처 도착지 가져오기',
    '/admin/customers/ecount': '이카운트 거래처정보',
    '/admin/customers/new': '신규 거래처',
    '/admin/suppliers': '매입처 관리',
};

function tabLabel(pathname: string) {
    if (MENU_TITLES[pathname]) return MENU_TITLES[pathname];
    if (/^\/admin\/orders\/[^/]+$/.test(pathname)) return '주문 상세';
    if (/^\/admin\/customers\/[^/]+\/ledger$/.test(pathname)) return '거래처 원장';
    if (/^\/admin\/customers\/[^/]+$/.test(pathname)) return '거래처 상세';
    if (/^\/admin\/suppliers\/[^/]+\/ledger$/.test(pathname)) return '매입처 원장';
    return '업무 화면';
}

function tabKey(pathname: string) {
    return pathname || '/admin';
}

function hrefWithSearch(pathname: string, search: string) {
    return search ? `${pathname}?${search}` : pathname;
}

function normalizeTabs(value: unknown): WorkspaceTab[] {
    if (!Array.isArray(value)) return [HOME_TAB];
    const byKey = new Map<string, WorkspaceTab>();
    byKey.set(HOME_TAB.key, HOME_TAB);
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const tab = item as Partial<WorkspaceTab>;
        if (!tab.key || !tab.href || !tab.label) continue;
        if (!tab.key.startsWith('/admin') || !tab.href.startsWith('/admin')) continue;
        byKey.set(tab.key, { key: tab.key, href: tab.href, label: tab.label, fixed: tab.key === HOME_TAB.key });
    }
    return Array.from(byKey.values());
}

export default function InternalWorkspaceShell({
    children,
    storageKey,
    rightSlot,
}: {
    children: ReactNode;
    storageKey: string;
    rightSlot?: ReactNode;
}) {
    const pathname = usePathname() || '/admin';
    const searchParams = useSearchParams();
    const router = useRouter();
    const hydratedRef = useRef(false);
    const [tabs, setTabs] = useState<WorkspaceTab[]>([HOME_TAB]);

    const search = searchParams.toString();
    const activeKey = tabKey(pathname);
    const activeHref = hrefWithSearch(pathname, search);

    useEffect(() => {
        try {
            const saved = window.localStorage.getItem(storageKey);
            if (saved) setTabs(normalizeTabs(JSON.parse(saved)));
        } catch {
            setTabs([HOME_TAB]);
        } finally {
            hydratedRef.current = true;
        }
    }, [storageKey]);

    useEffect(() => {
        if (!pathname.startsWith('/admin')) return;
        setTabs((prev) => {
            const normalized = normalizeTabs(prev);
            const nextTab: WorkspaceTab = {
                key: activeKey,
                href: activeHref,
                label: tabLabel(pathname),
                fixed: activeKey === HOME_TAB.key,
            };
            const existingIndex = normalized.findIndex((tab) => tab.key === activeKey);
            if (existingIndex >= 0) {
                const next = [...normalized];
                next[existingIndex] = { ...next[existingIndex], ...nextTab };
                return next;
            }
            return [...normalized, nextTab];
        });
    }, [activeHref, activeKey, pathname]);

    useEffect(() => {
        if (!hydratedRef.current) return;
        window.localStorage.setItem(storageKey, JSON.stringify(tabs));
    }, [storageKey, tabs]);

    function closeTab(key: string) {
        if (key === HOME_TAB.key) return;
        setTabs((prev) => {
            const currentIndex = prev.findIndex((tab) => tab.key === key);
            const next = prev.filter((tab) => tab.key !== key);
            if (key === activeKey) {
                const fallback = next[Math.max(0, Math.min(currentIndex - 1, next.length - 1))] ?? HOME_TAB;
                router.push(fallback.href);
            }
            return next.length ? next : [HOME_TAB];
        });
    }

    function closeOtherTabs() {
        const activeTab = tabs.find((tab) => tab.key === activeKey);
        setTabs(activeTab && activeTab.key !== HOME_TAB.key ? [HOME_TAB, activeTab] : [HOME_TAB]);
    }

    return (
        <>
            <div className="sticky top-0 z-40 border-b border-orange-100 bg-white/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/85">
                <div className="flex min-h-12 items-center gap-2 px-3 py-2">
                    <div className="flex shrink-0 items-center gap-2 pr-1">
                        <span className="text-sm font-black text-slate-900">한양유화 BNT OS</span>
                    </div>
                    <Link
                        href="/admin"
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-sm ${activeKey === HOME_TAB.key
                            ? 'border-orange-300 bg-orange-50 text-orange-700'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-orange-200 hover:text-orange-700'
                            }`}
                        title="메인"
                    >
                        <Home size={16} />
                    </Link>
                    <div className="flex flex-1 items-center gap-1 overflow-x-auto pb-0.5">
                        {tabs.map((tab, index) => {
                            const active = tab.key === activeKey;
                            return (
                                <div
                                    key={tab.key}
                                    className={`group flex h-9 shrink-0 items-center rounded-lg border text-sm shadow-sm ${active
                                        ? 'border-orange-300 bg-orange-50 text-orange-800'
                                        : 'border-slate-200 bg-white text-slate-600 hover:border-orange-200 hover:text-slate-900'
                                        }`}
                                >
                                    <Link
                                        href={tab.href}
                                        className="max-w-[11rem] truncate px-3 py-2 font-semibold"
                                        title={tab.label}
                                        aria-current={active ? 'page' : undefined}
                                    >
                                        {tab.label}
                                    </Link>
                                    {!tab.fixed && (
                                        <button
                                            type="button"
                                            onClick={() => closeTab(tab.key)}
                                            className={`mr-1 flex h-6 w-6 items-center justify-center rounded-md ${active
                                                ? 'text-orange-700 hover:bg-orange-100'
                                                : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                                                }`}
                                            aria-label={`${tab.label} 닫기`}
                                            title="닫기"
                                        >
                                            <X size={13} />
                                        </button>
                                    )}
                                    {active && tabs.length > 1 && (
                                        <span className="sr-only">{index + 1}번째 탭</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    {tabs.length > 2 && (
                        <button
                            type="button"
                            onClick={closeOtherTabs}
                            className="hidden h-9 shrink-0 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-500 hover:border-orange-200 hover:text-orange-700 sm:inline-flex sm:items-center"
                        >
                            다른 탭 닫기
                        </button>
                    )}
                    {rightSlot}
                </div>
            </div>
            {children}
        </>
    );
}
