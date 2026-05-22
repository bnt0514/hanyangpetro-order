'use client';

import { useState, useTransition } from 'react';
import { resetStaffPassword, resetCustomerPassword } from './actions';

type StaffItem = { id: string; name: string; role: string };
type CustomerItem = { id: string; name: string; companyName: string };

export default function AdminResetSection({
    staffList,
    customerList,
}: {
    staffList: StaffItem[];
    customerList: CustomerItem[];
}) {
    return (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-8">
            <h2 className="text-lg font-semibold text-slate-800">비밀번호 초기화 (관리자)</h2>

            {/* 직원 */}
            <div>
                <h3 className="text-sm font-semibold text-slate-600 mb-3">직원 — 이름으로 초기화</h3>
                <div className="space-y-2">
                    {staffList.map((u) => (
                        <ResetRow
                            key={u.id}
                            label={`${u.name} (${u.role})`}
                            defaultText={`초기 비밀번호: "${u.name}"`}
                            onReset={async () => {
                                const fd = new FormData();
                                fd.set('userId', u.id);
                                return resetStaffPassword(fd);
                            }}
                        />
                    ))}
                </div>
            </div>

            {/* 거래처 */}
            <div>
                <h3 className="text-sm font-semibold text-slate-600 mb-3">거래처 — 사업자번호로 초기화</h3>
                <div className="space-y-2">
                    {customerList.map((cu) => (
                        <ResetRow
                            key={cu.id}
                            label={`${cu.companyName} / ${cu.name}`}
                            defaultText="초기 비밀번호: 사업자번호 숫자"
                            onReset={async () => {
                                const fd = new FormData();
                                fd.set('customerUserId', cu.id);
                                return resetCustomerPassword(fd);
                            }}
                        />
                    ))}
                </div>
            </div>
        </section>
    );
}

function ResetRow({
    label,
    defaultText,
    onReset,
}: {
    label: string;
    defaultText: string;
    onReset: () => Promise<{ ok: boolean; message?: string; error?: string }>;
}) {
    const [pending, start] = useTransition();
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

    return (
        <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <span className="flex-1 text-sm text-slate-700">{label}</span>
            <span className="text-xs text-slate-400">{defaultText}</span>
            {msg && (
                <span className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>
            )}
            <button
                type="button"
                disabled={pending}
                onClick={() => {
                    if (!window.confirm(`"${label}" 비밀번호를 초기화하시겠습니까?`)) return;
                    setMsg(null);
                    start(async () => {
                        const res = await onReset();
                        setMsg({ ok: res.ok, text: res.ok ? (res.message ?? '초기화 완료') : (res.error ?? '오류') });
                    });
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition disabled:opacity-60"
            >
                {pending ? '처리 중...' : '초기화'}
            </button>
        </div>
    );
}
