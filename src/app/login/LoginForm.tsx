'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { Building2, UserRound, AlertCircle, LogIn } from 'lucide-react';
import { loginCustomer, loginStaff, type LoginResult } from './actions';
import Combobox, { type ComboboxOption } from '@/components/Combobox';

type Tab = 'customer' | 'staff';

export default function LoginForm({ customers }: { customers: ComboboxOption[] }) {
    const [tab, setTab] = useState<Tab>('customer');
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();
    const [companyName, setCompanyName] = useState('');

    function submitCustomer(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set('companyName', companyName);
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
                <h1 className="mt-4 text-2xl font-bold text-slate-800 tracking-tight">
                    주식회사 한양유화
                </h1>
                <p className="mt-1 text-sm text-slate-500">e-Business OS · 주문 관제 시스템</p>
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
                            <div>
                                <span className="block text-sm font-medium text-slate-700 mb-1.5">
                                    회사명
                                </span>
                                <Combobox
                                    options={customers}
                                    value={companyName}
                                    onChange={(v) => setCompanyName(v)}
                                    placeholder="회사명 일부 입력 (대소문자 무관)"
                                    required
                                />
                            </div>
                            <Field
                                label="비밀번호"
                                name="businessNumber"
                                type="password"
                                autoComplete="current-password"
                                required
                            />
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
                            <SubmitButton pending={pending}>직원 로그인</SubmitButton>
                        </form>
                    )}

                    <div className="mt-5 pt-5 border-t border-slate-100 text-center">
                        <a
                            href="https://hanyangpetro.com"
                            className="text-xs text-slate-500 hover:text-slate-700 transition"
                        >
                            ← 회사 홈페이지로 이동
                        </a>
                    </div>
                </div>
            </div>

            <p className="mt-6 text-center text-xs text-slate-400">
                © {new Date().getFullYear()} Hanyang Petrochemical Co., Ltd.
            </p>
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
