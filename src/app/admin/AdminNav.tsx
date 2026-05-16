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
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 transition"
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
                <div className="border-t border-slate-100 px-4 pb-4 pt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
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
}: {
    isHanwhaManager: boolean;
    canManageCreditLimits: boolean;
}) {
    const groups: NavGroup[] = [
        {
            title: '주문 / 배차',
            icon: '📦',
            items: [
                { href: '/admin/orders/new', label: '신규 주문 등록', icon: '➕', color: 'border-blue-200 bg-blue-50 text-blue-700' },
                { href: '/admin/dispatch', label: '한화 배차 조회', icon: '🚚', color: 'border-cyan-200 bg-cyan-50 text-cyan-700' },
                { href: '/admin/orders/deleted', label: '삭제된 주문', icon: '🗑', color: 'border-slate-200 bg-slate-50 text-slate-500' },
            ],
        },
        {
            title: '거래처 / 원장',
            icon: '🏢',
            items: [
                { href: '/admin/customers/new', label: '신규업체 등록', icon: '➕', color: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
                { href: '/admin/customers', label: '거래처 수정', icon: '✏️', color: 'border-emerald-200 bg-emerald-50 text-emerald-600' },
                { href: '/admin/ledger', label: '거래처원장 조회', icon: '📒', color: 'border-teal-200 bg-teal-50 text-teal-700' },
                { href: '/admin/warehouse', label: '창고 재고', icon: '🏭', color: 'border-blue-200 bg-blue-50 text-blue-700' },
            ],
        },
        {
            title: '수익 / 단가',
            icon: '📈',
            items: [
                { href: '/admin/reports/profit', label: '월별 수익/담당자', icon: '📊', color: 'border-purple-200 bg-purple-50 text-purple-700' },
                ...(isHanwhaManager
                    ? [{ href: '/admin/prices', label: '단가 관리', icon: '💲', color: 'border-indigo-200 bg-indigo-50 text-indigo-700' }]
                    : []),
                ...(isHanwhaManager
                    ? [{ href: '/admin/settings/hanwha', label: '한화 비번 관리', icon: '🔑', color: 'border-slate-200 bg-slate-50 text-slate-600' }]
                    : []),
            ],
        },
        {
            title: '여신 / 신용관리',
            icon: '🛡️',
            items: [
                { href: '/admin/credit-overrides', label: '여신 초과 승인', icon: '🛡', color: 'border-red-200 bg-red-50 text-red-600' },
                ...(canManageCreditLimits
                    ? [{ href: '/admin/credit-limits', label: '거래처별 여신관리', icon: '🧮', color: 'border-amber-200 bg-amber-50 text-amber-700' }]
                    : []),
            ],
        },
    ];

    return (
        <div className="mb-8 space-y-3">
            {groups.map((group, i) => (
                <AccordionGroup key={group.title} group={group} defaultOpen={i === 0} />
            ))}
        </div>
    );
}
