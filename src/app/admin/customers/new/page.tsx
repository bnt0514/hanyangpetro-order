'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createCustomer, addDeliveryAddress } from '../actions';

type Mode = 'customer+address' | 'customer' | 'address';

const MODE_OPTIONS: { value: Mode; label: string; desc: string }[] = [
    { value: 'customer+address', label: '업체 + 도착지 함께 등록', desc: '새 업체와 기본 도착지를 동시에 등록합니다.' },
    { value: 'customer', label: '업체만 등록', desc: '도착지는 나중에 따로 추가할 수 있습니다.' },
    { value: 'address', label: '도착지만 등록', desc: '기존 업체에 새 도착지를 추가합니다.' },
];

export default function NewCustomerPage() {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [mode, setMode] = useState<Mode>('customer+address');

    // 업체 정보
    const [cust, setCust] = useState({
        customerCode: '',
        companyName: '',
        businessNumber: '',
        creditLimit: '',
        paymentTerms: '',
        custMemo: '',
    });

    // 도착지 정보
    const [addr, setAddr] = useState({
        label: '',
        addressLine1: '',
        addressLine2: '',
        postalCode: '',
        contactName: '',
        contactPhone: '',
        addrMemo: '',
    });

    // 도착지만 등록 시 기존 업체 선택
    const [existingCustomerId, setExistingCustomerId] = useState('');
    const [existingCustomerSearch, setExistingCustomerSearch] = useState('');
    const [customers, setCustomers] = useState<{ id: string; companyName: string; customerCode: string }[]>([]);
    const [customersLoaded, setCustomersLoaded] = useState(false);

    async function loadCustomers() {
        if (customersLoaded) return;
        const res = await fetch('/api/customers/search?q=');
        if (res.ok) {
            const data = await res.json() as { id: string; companyName: string; customerCode: string }[];
            setCustomers(data);
        }
        setCustomersLoaded(true);
    }

    function handleCust(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
        setCust((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    }
    function handleAddr(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
        setAddr((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    }

    function submit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
            let result;
            if (mode === 'address') {
                result = await addDeliveryAddress({
                    customerId: existingCustomerId,
                    address: {
                        label: addr.label,
                        addressLine1: addr.addressLine1,
                        addressLine2: addr.addressLine2 || undefined,
                        postalCode: addr.postalCode || undefined,
                        contactName: addr.contactName || undefined,
                        contactPhone: addr.contactPhone || undefined,
                        memo: addr.addrMemo || undefined,
                    },
                });
            } else {
                result = await createCustomer({
                    customerCode: cust.customerCode,
                    companyName: cust.companyName,
                    businessNumber: cust.businessNumber || undefined,
                    creditLimit: cust.creditLimit ? Number(cust.creditLimit) : undefined,
                    paymentTerms: cust.paymentTerms || undefined,
                    memo: cust.custMemo || undefined,
                    address: mode === 'customer+address' ? {
                        label: addr.label,
                        addressLine1: addr.addressLine1,
                        addressLine2: addr.addressLine2 || undefined,
                        postalCode: addr.postalCode || undefined,
                        contactName: addr.contactName || undefined,
                        contactPhone: addr.contactPhone || undefined,
                        memo: addr.addrMemo || undefined,
                    } : undefined,
                });
            }
            if (!result.ok) {
                setError(result.error);
                return;
            }
            router.push('/admin');
        });
    }

    const filteredCustomers = customers.filter(
        (c) =>
            c.companyName.includes(existingCustomerSearch) ||
            c.customerCode.includes(existingCustomerSearch),
    );

    const showCustomer = mode === 'customer+address' || mode === 'customer';
    const showAddress = mode === 'customer+address' || mode === 'address';

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="bg-white border-b border-slate-200">
                <div className="max-w-2xl mx-auto px-6 h-16 flex items-center">
                    <Link href="/admin" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
                        <ArrowLeft size={14} /> 홈으로
                    </Link>
                </div>
            </header>

            <main className="max-w-2xl mx-auto p-6 space-y-4">
                <h1 className="text-2xl font-bold text-slate-800">신규 등록</h1>

                {/* 등록 방식 선택 */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">등록 방식</p>
                    <div className="flex flex-col gap-2">
                        {MODE_OPTIONS.map((opt) => (
                            <label
                                key={opt.value}
                                className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer transition ${mode === opt.value
                                        ? 'border-blue-500 bg-blue-50'
                                        : 'border-slate-200 hover:bg-slate-50'
                                    }`}
                            >
                                <input
                                    type="radio"
                                    name="mode"
                                    value={opt.value}
                                    checked={mode === opt.value}
                                    onChange={(e) => {
                                        setMode(e.target.value as Mode);
                                        if (e.target.value === 'address') loadCustomers();
                                    }}
                                    className="mt-0.5"
                                />
                                <div>
                                    <p className="text-sm font-semibold text-slate-800">{opt.label}</p>
                                    <p className="text-xs text-slate-400">{opt.desc}</p>
                                </div>
                            </label>
                        ))}
                    </div>
                </div>

                <form onSubmit={submit} className="space-y-4">
                    {/* 업체 정보 섹션 */}
                    {showCustomer && (
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">업체 정보</p>

                            <Field label="거래처코드 *">
                                <input name="customerCode" value={cust.customerCode} onChange={handleCust}
                                    placeholder="비워두면 자동 생성" className="inp" />
                                <p className="mt-1 text-xs text-slate-400">미입력 시 기존 거래처코드의 마지막 숫자 다음 번호로 자동 등록됩니다.</p>
                            </Field>
                            <Field label="업체명 *">
                                <input name="companyName" value={cust.companyName} onChange={handleCust}
                                    placeholder="주식회사 ○○○" required className="inp" />
                            </Field>
                            <Field label="사업자등록번호">
                                <input name="businessNumber" value={cust.businessNumber} onChange={handleCust}
                                    placeholder="000-00-00000" className="inp" />
                            </Field>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="여신한도 (원)">
                                    <input name="creditLimit" type="number" min="0" step="1"
                                        value={cust.creditLimit} onChange={handleCust} placeholder="0" className="inp" />
                                </Field>
                                <Field label="결제조건">
                                    <input name="paymentTerms" value={cust.paymentTerms} onChange={handleCust}
                                        placeholder="예: 월말 익월 10일" className="inp" />
                                </Field>
                            </div>
                            <Field label="메모">
                                <textarea name="custMemo" value={cust.custMemo} onChange={handleCust}
                                    rows={2} className="inp resize-none" />
                            </Field>
                        </div>
                    )}

                    {/* 도착지만 등록 시 기존 업체 선택 */}
                    {mode === 'address' && (
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">업체 선택 *</p>
                            <input
                                type="text"
                                placeholder="업체명 또는 코드 검색..."
                                value={existingCustomerSearch}
                                onChange={(e) => setExistingCustomerSearch(e.target.value)}
                                className="inp"
                            />
                            <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                                {filteredCustomers.length === 0 && (
                                    <p className="p-3 text-xs text-slate-400">
                                        {customersLoaded ? '검색 결과 없음' : '로딩 중...'}
                                    </p>
                                )}
                                {filteredCustomers.map((c) => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        onClick={() => setExistingCustomerId(c.id)}
                                        className={`w-full text-left px-3 py-2.5 text-sm transition ${existingCustomerId === c.id
                                                ? 'bg-blue-50 text-blue-700 font-semibold'
                                                : 'hover:bg-slate-50'
                                            }`}
                                    >
                                        {c.companyName}
                                        <span className="ml-2 text-xs text-slate-400">{c.customerCode}</span>
                                    </button>
                                ))}
                            </div>
                            {existingCustomerId && (
                                <p className="text-xs text-blue-600">
                                    ✓ 선택됨: {customers.find((c) => c.id === existingCustomerId)?.companyName}
                                </p>
                            )}
                        </div>
                    )}

                    {/* 도착지 정보 섹션 */}
                    {showAddress && (
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">도착지 정보</p>

                            <Field label="도착지 이름 *">
                                <input name="label" value={addr.label} onChange={handleAddr}
                                    placeholder="예: 본사창고, 1공장 등" required={showAddress} className="inp" />
                            </Field>
                            <Field label="주소 *">
                                <input name="addressLine1" value={addr.addressLine1} onChange={handleAddr}
                                    placeholder="도로명 주소" required={showAddress} className="inp" />
                            </Field>
                            <Field label="상세주소">
                                <input name="addressLine2" value={addr.addressLine2} onChange={handleAddr}
                                    placeholder="동/호수, 층 등" className="inp" />
                            </Field>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="우편번호">
                                    <input name="postalCode" value={addr.postalCode} onChange={handleAddr}
                                        placeholder="00000" className="inp" />
                                </Field>
                                <Field label="담당자명">
                                    <input name="contactName" value={addr.contactName} onChange={handleAddr}
                                        placeholder="홍길동" className="inp" />
                                </Field>
                            </div>
                            <Field label="담당자 연락처">
                                <input name="contactPhone" value={addr.contactPhone} onChange={handleAddr}
                                    placeholder="010-0000-0000" className="inp" />
                            </Field>
                            <Field label="메모">
                                <textarea name="addrMemo" value={addr.addrMemo} onChange={handleAddr}
                                    rows={2} className="inp resize-none" />
                            </Field>
                        </div>
                    )}

                    {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2">{error}</p>}

                    <div className="flex justify-end gap-2 pb-8">
                        <Link href="/admin"
                            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                            취소
                        </Link>
                        <button type="submit" disabled={pending}
                            className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                            {pending ? '등록 중...' : '저장'}
                        </button>
                    </div>
                </form>
            </main>

            <style>{`
                .inp {
                    width: 100%;
                    border-radius: 0.5rem;
                    border: 1px solid #cbd5e1;
                    padding: 0.5rem 0.75rem;
                    font-size: 0.875rem;
                    outline: none;
                    background: white;
                }
                .inp:focus { border-color: #3b82f6; }
            `}</style>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
            {children}
        </div>
    );
}
