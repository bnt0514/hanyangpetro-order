'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, KeyRound, Loader2, AlertCircle, CheckCircle2, Save, RefreshCw } from 'lucide-react';
import { runHanwhaKeepAliveOnce, updateHanwhaPassword } from '@/app/dispatch/actions';
import { fmtDateTime } from '@/lib/orders';
import { useF8SaveShortcut } from '@/hooks/useF8SaveShortcut';

interface Props {
    username: string | null;
    masked: string;
    source: 'db' | 'env' | 'none';
    updatedAt: string | null;
    updatedByName: string | null;
    canRunKeepAlive: boolean;
}

export default function HanwhaCredentialClient({
    username,
    masked,
    source,
    updatedAt,
    updatedByName,
    canRunKeepAlive,
}: Props) {
    const router = useRouter();
    const formRef = useRef<HTMLFormElement | null>(null);
    const [pw, setPw] = useState('');
    const [pw2, setPw2] = useState('');
    const [show, setShow] = useState(false);
    const [pending, startTransition] = useTransition();
    const [keepAlivePending, startKeepAliveTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);

    function submit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setInfo(null);
        if (pw !== pw2) {
            setError('두 비밀번호가 일치하지 않습니다.');
            return;
        }
        startTransition(async () => {
            const r = await updateHanwhaPassword(pw);
            if (!r.ok) {
                setError(r.error);
                return;
            }
            setInfo(r.message);
            setPw('');
            setPw2('');
            router.refresh();
        });
    }

    useF8SaveShortcut(() => formRef.current?.requestSubmit(), { disabled: pending || !pw || !pw2, scopeRef: formRef });

    function runKeepAlive() {
        setError(null);
        setInfo(null);
        startKeepAliveTransition(async () => {
            const r = await runHanwhaKeepAliveOnce();
            if (!r.ok) {
                setError(r.error);
                return;
            }
            setInfo(r.message);
        });
    }

    return (
        <div className="mt-6 space-y-6">
            {/* 현재 상태 */}
            <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                    <KeyRound size={16} className="text-slate-500" />
                    현재 등록된 자격증명
                </h2>
                <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
                    <dt className="text-slate-500">아이디</dt>
                    <dd className="text-slate-800 font-mono">{username ?? '-'}</dd>

                    <dt className="text-slate-500">비밀번호</dt>
                    <dd className="text-slate-800 font-mono">
                        {masked || '-'}{' '}
                        <span className="ml-2 text-xs text-slate-400">
                            ({source === 'db' ? 'DB 저장' : source === 'env' ? '.env 기본값' : '미설정'})
                        </span>
                    </dd>

                    <dt className="text-slate-500">최근 변경</dt>
                    <dd className="text-slate-600 text-xs">
                        {updatedAt ? (
                            <>
                                {fmtDateTime(updatedAt)}
                                {updatedByName && ` · ${updatedByName}`}
                            </>
                        ) : (
                            <span className="text-slate-400">기록 없음</span>
                        )}
                    </dd>
                </dl>
            </section>

            {/* 변경 폼 */}
            <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h2 className="text-sm font-semibold text-slate-700 mb-4">새 비밀번호 등록</h2>
                <form ref={formRef} onSubmit={submit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1.5">
                            새 비밀번호
                        </label>
                        <div className="relative">
                            <input
                                type={show ? 'text' : 'password'}
                                value={pw}
                                onChange={(e) => setPw(e.target.value)}
                                disabled={pending}
                                autoComplete="new-password"
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-10 text-sm font-mono outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                                placeholder="한화 사이트의 새 비밀번호"
                            />
                            <button
                                type="button"
                                onClick={() => setShow((v) => !v)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                            >
                                {show ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1.5">
                            새 비밀번호 확인
                        </label>
                        <input
                            type={show ? 'text' : 'password'}
                            value={pw2}
                            onChange={(e) => setPw2(e.target.value)}
                            disabled={pending}
                            autoComplete="new-password"
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                            placeholder="한 번 더 입력"
                        />
                    </div>

                    {error && (
                        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                            <AlertCircle size={16} className="mt-0.5 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}
                    {info && !error && (
                        <div className="flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">
                            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                            <span>{info}</span>
                        </div>
                    )}

                    <div className="flex items-center gap-3 pt-2">
                        {canRunKeepAlive && (
                            <button
                                type="button"
                                disabled={keepAlivePending || pending}
                                onClick={runKeepAlive}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                            >
                                {keepAlivePending ? (
                                    <Loader2 size={16} className="animate-spin" />
                                ) : (
                                    <RefreshCw size={16} />
                                )}
                                연결유지 실행
                            </button>
                        )}
                        <button
                            type="submit"
                            disabled={pending || !pw || !pw2}
                            title="F8로도 저장할 수 있습니다"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-semibold shadow-sm disabled:opacity-60"
                        >
                            {pending ? (
                                <Loader2 size={16} className="animate-spin" />
                            ) : (
                                <Save size={16} />
                            )}
                            비밀번호 저장 (F8)
                        </button>
                        <p className="text-xs text-slate-400">
                            저장 즉시 다음 배차 조회부터 새 비밀번호가 적용됩니다.
                        </p>
                    </div>
                </form>
            </section>

            <div className="text-xs text-slate-400 leading-relaxed bg-slate-50 rounded-lg p-4 border border-slate-200">
                💡 한화 H-CRM 비밀번호는 보안 정책에 따라 주기적으로 변경됩니다. 변경 후 직원/고객에게는
                일시적으로 &quot;배차 조회 실패&quot; 오류가 표시되며, 담당자(대표·관리자)가 새 비밀번호를
                여기에 입력하면 즉시 정상화됩니다.
            </div>
        </div>
    );
}
