'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveDeliveryAddress, updateCustomer } from '../actions';

type CustomerVM = {
    id: string;
    customerCode: string;
    companyName: string;
    businessNumber: string | null;
    creditLimit: number;
    paymentTerms: string | null;
    memo: string | null;
    isActive: boolean;
};

type AddressVM = {
    id: string;
    label: string;
    addressLine1: string;
    addressLine2: string | null;
    postalCode: string | null;
    contactName: string | null;
    contactPhone: string | null;
    isDefault: boolean;
    isActive: boolean;
    memo: string | null;
};

const emptyAddress = {
    label: '',
    addressLine1: '',
    addressLine2: '',
    postalCode: '',
    contactName: '',
    contactPhone: '',
    isDefault: false,
    isActive: true,
    memo: '',
};

export default function CustomerEditor({ customer, addresses }: { customer: CustomerVM; addresses: AddressVM[] }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [message, setMessage] = useState<string | null>(null);
    const [selectedAddressId, setSelectedAddressId] = useState(addresses[0]?.id ?? 'new');
    const [customerForm, setCustomerForm] = useState({
        customerCode: customer.customerCode,
        companyName: customer.companyName,
        businessNumber: customer.businessNumber ?? '',
        creditLimit: String(customer.creditLimit ?? 0),
        paymentTerms: customer.paymentTerms ?? '',
        memo: customer.memo ?? '',
        isActive: customer.isActive,
    });

    const selectedAddress = useMemo(
        () => addresses.find((address) => address.id === selectedAddressId),
        [addresses, selectedAddressId],
    );
    const [addressForm, setAddressForm] = useState(() => toAddressForm(selectedAddress));

    function selectAddress(addressId: string) {
        const nextAddress = addresses.find((address) => address.id === addressId);
        setSelectedAddressId(addressId);
        setAddressForm(toAddressForm(nextAddress));
        setMessage(null);
    }

    function saveCustomer() {
        setMessage(null);
        startTransition(async () => {
            const result = await updateCustomer(customer.id, {
                ...customerForm,
                creditLimit: Number(customerForm.creditLimit),
            });
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setMessage('업체 정보가 저장되었습니다.');
            router.refresh();
        });
    }

    function saveAddress() {
        setMessage(null);
        startTransition(async () => {
            const result = await saveDeliveryAddress({
                customerId: customer.id,
                addressId: selectedAddressId === 'new' ? undefined : selectedAddressId,
                address: addressForm,
            });
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setMessage('도착지가 저장되었습니다.');
            router.refresh();
        });
    }

    return (
        <div className="space-y-6">
            <div>
                <p className="text-xs font-mono text-slate-400">{customer.customerCode}</p>
                <h1 className="text-2xl font-bold text-slate-800">{customer.companyName}</h1>
                <p className="mt-1 text-sm text-slate-500">업체 정보와 도착지를 수정합니다.</p>
            </div>

            {message && (
                <p className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-2 text-sm text-blue-700">{message}</p>
            )}

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                <h2 className="font-semibold text-slate-800">업체 정보</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Field label="거래처코드 *">
                        <input className="inp" value={customerForm.customerCode} onChange={(e) => setCustomerForm({ ...customerForm, customerCode: e.target.value })} />
                    </Field>
                    <Field label="업체명 *">
                        <input className="inp" value={customerForm.companyName} onChange={(e) => setCustomerForm({ ...customerForm, companyName: e.target.value })} />
                    </Field>
                    <Field label="사업자등록번호">
                        <input className="inp" value={customerForm.businessNumber} onChange={(e) => setCustomerForm({ ...customerForm, businessNumber: e.target.value })} />
                    </Field>
                    <Field label="여신한도">
                        <input className="inp" type="number" min="0" value={customerForm.creditLimit} onChange={(e) => setCustomerForm({ ...customerForm, creditLimit: e.target.value })} />
                    </Field>
                    <Field label="결제조건">
                        <input className="inp" value={customerForm.paymentTerms} onChange={(e) => setCustomerForm({ ...customerForm, paymentTerms: e.target.value })} />
                    </Field>
                    <label className="flex items-center gap-2 pt-6 text-sm text-slate-700">
                        <input type="checkbox" checked={customerForm.isActive} onChange={(e) => setCustomerForm({ ...customerForm, isActive: e.target.checked })} />
                        사용중
                    </label>
                </div>
                <Field label="메모">
                    <textarea className="inp resize-none" rows={2} value={customerForm.memo} onChange={(e) => setCustomerForm({ ...customerForm, memo: e.target.value })} />
                </Field>
                <div className="flex justify-end">
                    <button type="button" disabled={pending} onClick={saveCustomer} className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60">
                        업체 정보 저장
                    </button>
                </div>
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-slate-100 px-5 py-4 flex items-center justify-between">
                        <h2 className="font-semibold text-slate-800">도착지 목록</h2>
                        <button type="button" onClick={() => selectAddress('new')} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
                            추가
                        </button>
                    </div>
                    <div className="divide-y divide-slate-100">
                        <button type="button" onClick={() => selectAddress('new')} className={`w-full px-5 py-3 text-left text-sm ${selectedAddressId === 'new' ? 'bg-blue-50 text-blue-700 font-semibold' : 'hover:bg-slate-50 text-slate-600'}`}>
                            + 새 도착지
                        </button>
                        {addresses.map((address) => (
                            <button key={address.id} type="button" onClick={() => selectAddress(address.id)} className={`w-full px-5 py-3 text-left ${selectedAddressId === address.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                                <p className="text-sm font-semibold text-slate-800">
                                    {address.label}
                                    {address.isDefault && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">기본</span>}
                                    {!address.isActive && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">중지</span>}
                                </p>
                                <p className="mt-0.5 truncate text-xs text-slate-400">{address.addressLine1 || '주소 없음'}</p>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                    <h2 className="font-semibold text-slate-800">{selectedAddressId === 'new' ? '도착지 추가' : '도착지 수정'}</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Field label="도착지명 *">
                            <input className="inp" value={addressForm.label} onChange={(e) => setAddressForm({ ...addressForm, label: e.target.value })} />
                        </Field>
                        <Field label="우편번호">
                            <input className="inp" value={addressForm.postalCode} onChange={(e) => setAddressForm({ ...addressForm, postalCode: e.target.value })} />
                        </Field>
                    </div>
                    <Field label="주소 *">
                        <input className="inp" value={addressForm.addressLine1} onChange={(e) => setAddressForm({ ...addressForm, addressLine1: e.target.value })} />
                    </Field>
                    <Field label="상세주소">
                        <input className="inp" value={addressForm.addressLine2} onChange={(e) => setAddressForm({ ...addressForm, addressLine2: e.target.value })} />
                    </Field>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Field label="담당자명">
                            <input className="inp" value={addressForm.contactName} onChange={(e) => setAddressForm({ ...addressForm, contactName: e.target.value })} />
                        </Field>
                        <Field label="담당자 연락처">
                            <input className="inp" value={addressForm.contactPhone} onChange={(e) => setAddressForm({ ...addressForm, contactPhone: e.target.value })} />
                        </Field>
                    </div>
                    <Field label="메모">
                        <textarea className="inp resize-none" rows={2} value={addressForm.memo} onChange={(e) => setAddressForm({ ...addressForm, memo: e.target.value })} />
                    </Field>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-4 text-sm text-slate-700">
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={addressForm.isDefault} onChange={(e) => setAddressForm({ ...addressForm, isDefault: e.target.checked })} />
                                기본 도착지
                            </label>
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={addressForm.isActive} onChange={(e) => setAddressForm({ ...addressForm, isActive: e.target.checked })} />
                                사용중
                            </label>
                        </div>
                        <button type="button" disabled={pending} onClick={saveAddress} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                            도착지 저장
                        </button>
                    </div>
                </div>
            </section>

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

function toAddressForm(address?: AddressVM) {
    if (!address) return emptyAddress;
    return {
        label: address.label,
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2 ?? '',
        postalCode: address.postalCode ?? '',
        contactName: address.contactName ?? '',
        contactPhone: address.contactPhone ?? '',
        isDefault: address.isDefault,
        isActive: address.isActive,
        memo: address.memo ?? '',
    };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
            {children}
        </div>
    );
}