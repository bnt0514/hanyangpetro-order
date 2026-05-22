'use client';

import { useState, useTransition } from 'react';
import { changeMyPassword } from './actions';

export default function ChangePasswordForm() {
    const [pending, start] = useTransition();
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

    function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setMsg(null);
        const fd = new FormData(e.currentTarget);
        start(async () => {
            const res = await changeMyPassword(fd);
            if (res.ok) {
                setMsg({ ok: true, text: '비밀번호가 변경됐습니다.' });
                (e.target as HTMLFormElement).reset();
            } else {
                setMsg({ ok: false, text: res.error ?? '오류가 발생했습니다.' });
            }
        });
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">현재 비밀번호</label>
                <input
                    type="password"
                    name="current"
                    required
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">새 비밀번호</label>
                <input
                    type="password"
                    name="next"
                    required
                    minLength={4}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">새 비밀번호 확인</label>
                <input
                    type="password"
                    name="confirm"
                    required
                    minLength={4}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
            </div>
            {msg && (
                <div className={`rounded-lg px-4 py-3 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                    {msg.text}
                </div>
            )}
            <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 text-sm transition disabled:opacity-60"
            >
                {pending ? '변경 중...' : '비밀번호 변경'}
            </button>
        </form>
    );
}
