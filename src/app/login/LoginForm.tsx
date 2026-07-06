'use client';

import { useState, useTransition, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { Building2, UserRound, AlertCircle, LogIn, Search } from 'lucide-react';
import { loginCustomer, loginStaff, type LoginResult } from './actions';
import HomeShortcutButton from './HomeShortcutButton';
import HomepageArchiveLink from '@/components/HomepageArchiveLink';

type Tab = 'customer' | 'staff';

export default function LoginForm() {
    const [tab, setTab] = useState<Tab>('customer');
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function submitCustomer(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        startTransition(async () => {
            const result = await loginCustomer(fd);
            if (result && result.ok === false) setError(result.error);
        });
    }

    function submitStaff(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        startTransition(async () => {
            const result = await loginStaff(fd);
            if (result && result.ok === false) setError(result.error);
        });
    }

    return (
        <div className="w-full max-w-md">
            {/* Logo block */}
            <div className="flex flex-col items-center mb-8">
                <Image
                    src="/hanyanglogo.png"
                    alt="한양유화 로고"
                    width={120}
                    height={120}
                    priority
                    className="h-24 w-auto drop-shadow-md"
                />
                <div className="mt-4 flex items-center justify-center gap-2">
                    <p className="text-base font-bold text-slate-800">한양유화 BNT OS</p>
                    <HomepageArchiveLink />
                </div>
                <p className="mt-1 text-sm text-slate-500">주문 관리 시스템</p>
            </div>

            {/* Card */}
            <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
                {/* Tabs */}
                <div className="grid grid-cols-2 border-b border-slate-100">
                    <TabButton
                        active={tab === 'customer'}
                        onClick={() => {
                            setTab('customer');
                            setError(null);
                        }}
                        icon={<Building2 size={18} />}
                        label="거래처 로그인"
                    />
                    <TabButton
                        active={tab === 'staff'}
                        onClick={() => {
                            setTab('staff');
                            setError(null);
                        }}
                        icon={<UserRound size={18} />}
                        label="직원 로그인"
                    />
                </div>

                <div className="p-7">
                    {error && (
                        <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                            <AlertCircle size={16} className="mt-0.5 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {tab === 'customer' ? (
                        <form onSubmit={submitCustomer} className="space-y-4">
                            <CompanyNameField />
                            <Field
                                label="비밀번호"
                                name="businessNumber"
                                type="password"
                                autoComplete="current-password"
                                required
                            />
                                                        <AutoLoginCheckbox />
<SubmitButton pending={pending}>거래처 로그인</SubmitButton>
                        </form>
                    ) : (
                        <form onSubmit={submitStaff} className="space-y-4">
                            <Field
                                label="아이디 (이름)"
                                name="loginId"
                                type="text"
                                autoComplete="username"
                                required
                            />
                            <Field
                                label="비밀번호"
                                name="password"
                                type="password"
                                autoComplete="current-password"
                                required
                            />
                            <AutoLoginCheckbox />
                            <SubmitButton pending={pending}>직원 로그인</SubmitButton>
                        </form>
                    )}

                    <HomeShortcutButton />

                </div>
            </div>

            <p className="mt-6 text-center text-xs text-slate-400">
                © {new Date().getFullYear()} BNT · Hanyang Petrochemical
            </p>
        </div>
    );
}


function AutoLoginCheckbox() {
    return (
        <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
                type="checkbox"
                name="autoLogin"
                defaultChecked
                className="h-4 w-4 rounded border-slate-300 accent-blue-600"
            />
            <span className="text-sm text-slate-600">자동 로그인 (이 기기에서 90일간 유지)</span>
        </label>
    );
}

function CompanyNameField() {
    const [query, setQuery] = useState('');
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState('');
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    const fetchSuggestions = useCallback(async (q: string) => {
        if (q.length < 1) { setSuggestions([]); setOpen(false); return; }
        try {
            const res = await fetch(`/api/customers/search-public?q=${encodeURIComponent(q)}`);
            const data: string[] = await res.json();
            setSuggestions(data);
            setOpen(data.length > 0);
        } catch {
            setSuggestions([]);
        }
    }, []);

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
        const val = e.target.value;
        setQuery(val);
        setSelected('');
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => fetchSuggestions(val), 250);
    }

    function handleSelect(name: string) {
        setQuery(name);
        setSelected(name);
        setSuggestions([]);
        setOpen(false);
    }

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div ref={wrapperRef} className="relative">
            <label className="block">
                <span className="block text-sm font-medium text-slate-700 mb-1.5">회사명</span>
                <div className="relative">
                    <input
                        name="companyName"
                        type="text"
                        value={query}
                        onChange={handleChange}
                        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
                        placeholder="회사명 일부를 입력하면 목록이 나타납니다"
                        autoComplete="off"
                        required
                        className="w-full rounded-lg border border-slate-300 bg-white pl-3.5 pr-9 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                    <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
            </label>
            {open && (
                <ul className="absolute z-50 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg text-sm max-h-48 overflow-y-auto">
                    {suggestions.map((name) => (
                        <li
                            key={name}
                            onMouseDown={() => handleSelect(name)}
                            className="px-4 py-2.5 cursor-pointer hover:bg-blue-50 hover:text-blue-700"
                        >
                            {name}
                        </li>
                    ))}
                </ul>
            )}
            {selected && (
                <p className="mt-1 text-xs text-emerald-600">✓ 선택됨: {selected}</p>
            )}
        </div>
    );
}

function TabButton({
    active,
    onClick,
    icon,
    label,
}: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition ${active
                ? 'bg-white text-blue-700 border-b-2 border-blue-600'
                : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                }`}
        >
            {icon}
            {label}
        </button>
    );
}

function Field({
    label,
    name,
    type = 'text',
    placeholder,
    autoComplete,
    required,
}: {
    label: string;
    name: string;
    type?: string;
    placeholder?: string;
    autoComplete?: string;
    required?: boolean;
}) {
    return (
        <label className="block">
            <span className="block text-sm font-medium text-slate-700 mb-1.5">{label}</span>
            <input
                name={name}
                type={type}
                placeholder={placeholder}
                autoComplete={autoComplete}
                required={required}
                className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
        </label>
    );
}

function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
    return (
        <button
            type="submit"
            disabled={pending}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-60 disabled:cursor-not-allowed"
        >
            <LogIn size={16} />
            {pending ? '로그인 중…' : children}
        </button>
    );
}
