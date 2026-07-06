'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';

type NavItem = {
    href: string;
    label: string;
    icon?: string;
    color?: string;
};

type NavGroup = {
    title: string;
    icon: string;
    items: NavItem[];
};

function AccordionGroup({ group, defaultOpen = false }: { group: NavGroup; defaultOpen?: boolean }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center justify-between px-5 py-4 text-left transition hover:bg-slate-50"
            >
                <span className="flex items-center gap-2 font-semibold text-slate-700">
                    <span className="text-lg">{group.icon}</span>
                    {group.title}
                </span>
                <ChevronDown
                    size={18}
                    className={`text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                />
            </button>
            {open && (
                <div className="grid grid-cols-1 gap-2 border-t border-slate-100 px-4 pb-4 pt-3">
                    {group.items.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition hover:opacity-80 ${item.color ?? 'border-slate-200 bg-slate-50 text-slate-700'}`}
                        >
                            {item.icon && <span>{item.icon}</span>}
                            {item.label}
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function AdminNav({
    isHanwhaManager,
    canManageCreditLimits,
    canViewAllStaffData,
}: {
    isHanwhaManager: boolean;
    canManageCreditLimits: boolean;
    canViewAllStaffData: boolean;
}) {
    const groups: NavGroup[] = [
        {
            title: '주문 / 배차',
            icon: '📦',
            items: [
                { href: '/admin/orders/new', label: '오더 등록', icon: '➕', color: 'border-blue-200 bg-blue-50 text-blue-700' },
                { href: '/admin/orders/sheet-reconcile', label: '매입매출 오더 대조', icon: '↔', color: 'border-orange-200 bg-white text-orange-700' },
                { href: '/admin/dispatch', label: '배차 조회', icon: '🚚', color: 'border-cyan-200 bg-cyan-50 text-cyan-700' },
                ...(isHanwhaManager
                    ? [{ href: '/admin/settings/hanwha', label: '한화 비번', icon: '🔑', color: 'border-orange-100 bg-white text-slate-700' }]
                    : []),
                { href: '/admin/orders/deleted', label: '삭제된 주문', icon: '🗑', color: 'border-slate-200 bg-slate-50 text-slate-500' },
            ],
        },
        {
            title: '거래처 / 여신',
            icon: '🤝',
            items: [
                { href: '/admin/customers', label: '거래처 관리', icon: '🏢', color: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
                { href: '/admin/reports/customer-patterns', label: '거래처 패턴', icon: '🔁', color: 'border-emerald-200 bg-white text-emerald-700' },
                ...(canViewAllStaffData
                    ? [{ href: '/admin/credit-overrides', label: '여신 초과 승인', icon: '🛡', color: 'border-red-200 bg-red-50 text-red-600' }]
                    : []),
                ...(canManageCreditLimits
                    ? [{ href: '/admin/credit-limits', label: '여신 한도 관리', icon: '🧮', color: 'border-amber-200 bg-amber-50 text-amber-700' }]
                    : []),
            ],
        },
        {
            title: '원장 / 수금',
            icon: '📒',
            items: [
                { href: '/admin/ledger', label: '원장 통합조회', icon: '📒', color: 'border-teal-200 bg-teal-50 text-teal-700' },
                ...(canViewAllStaffData
                    ? [
                        { href: '/admin/finance-transactions', label: '입출금 등록', icon: '💳', color: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
                        { href: '/admin/collections', label: '수금 대조', icon: '₩', color: 'border-emerald-200 bg-white text-emerald-700' },
                        { href: '/admin/ledger/manual-entry', label: '수기 원장 입력', icon: '✍️', color: 'border-amber-200 bg-amber-50 text-amber-700' },
                    ]
                    : []),
            ],
        },
        {
            title: '재고 / 품목 / 단가',
            icon: '🏭',
            items: [
                { href: '/admin/warehouse', label: '창고 재고', icon: '🏭', color: 'border-blue-200 bg-blue-50 text-blue-700' },
                { href: '/admin/products', label: '품목 관리', icon: '🧾', color: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
                ...(isHanwhaManager
                    ? [{ href: '/admin/prices', label: '단가 관리', icon: '💲', color: 'border-indigo-200 bg-indigo-50 text-indigo-700' }]
                    : []),
            ],
        },
        {
            title: '분석 / 리포트',
            icon: '📈',
            items: [
                { href: '/admin/reports/sales-daily', label: '매입매출 조회', icon: '📅', color: 'border-orange-200 bg-orange-50 text-orange-700' },
                { href: '/admin/reports/performance', label: '기간별 매입매출', icon: '📈', color: 'border-blue-200 bg-blue-50 text-blue-700' },
                ...(canViewAllStaffData
                    ? [{ href: '/admin/reports/profit', label: '수익 분석', icon: '📊', color: 'border-purple-200 bg-purple-50 text-purple-700' }]
                    : []),
            ],
        },
    ];

    return (
        <nav className="space-y-3">
            {groups.map((group, i) => (
                <AccordionGroup key={group.title} group={group} defaultOpen={i === 0} />
            ))}
        </nav>
    );
}
