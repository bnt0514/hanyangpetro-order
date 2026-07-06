'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Combobox, { type ComboboxOption } from '@/components/Combobox';
import { updateOrderCustomerAndDeliveryAddress } from '@/app/orders/actions';

type CustomerOption = {
    id: string;
    companyName: string;
    customerCode: string;
};

type AddressOption = {
    id: string;
    customerId: string;
    label: string;
    addressLine1: string;
    addressLine2: string | null;
    contactPhone: string | null;
};

function addressLabel(address: AddressOption) {
    return [
        address.label,
        address.addressLine1,
        address.addressLine2,
    ].filter(Boolean).join(' - ');
}

function addressSublabel(address: AddressOption) {
    return [
        address.addressLine1,
        address.addressLine2,
        address.contactPhone,
    ].filter(Boolean).join(' / ');
}

export default function OrderCustomerAddressEditor({
    orderId,
    currentCustomerId,
    currentDeliveryAddressId,
    customers,
    addresses,
    className = '',
}: {
    orderId: string;
    currentCustomerId: string;
    currentDeliveryAddressId: string;
    customers: CustomerOption[];
    addresses: AddressOption[];
    className?: string;
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [customerId, setCustomerId] = useState(currentCustomerId);
    const [addressId, setAddressId] = useState(currentDeliveryAddressId);
    const [reason, setReason] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();
    const router = useRouter();

    const customerOptions = useMemo<ComboboxOption[]>(
        () => customers.map((customer) => ({
            value: customer.id,
            label: customer.companyName,
            sublabel: customer.customerCode,
        })),
        [customers],
    );

    const addressOptions = useMemo<ComboboxOption[]>(
        () => addresses
            .filter((address) => address.customerId === customerId)
            .map((address) => ({
                value: address.id,
                label: addressLabel(address),
                sublabel: addressSublabel(address),
            })),
        [addresses, customerId],
    );

    const hasChanged = customerId !== currentCustomerId || addressId !== currentDeliveryAddressId;

    const handleCustomerChange = (nextCustomerId: string) => {
        setCustomerId(nextCustomerId);
        setAddressId(nextCustomerId === currentCustomerId ? currentDeliveryAddressId : '');
        setMessage(null);
    };

    const reset = () => {
        setCustomerId(currentCustomerId);
        setAddressId(currentDeliveryAddressId);
        setReason('');
        setMessage(null);
        setIsEditing(false);
    };

    const save = () => {
        setMessage(null);
        startTransition(async () => {
            const result = await updateOrderCustomerAndDeliveryAddress(orderId, customerId, addressId, reason);
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setMessage('거래처와 도착지를 수정했습니다.');
            setIsEditing(false);
            router.refresh();
        });
    };

    if (!isEditing) {
        return (
            <div className={`mt-3 ${className}`}>
                <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700"
                >
                    거래처/도착지 수정
                </button>
                {message && <p className="mt-2 text-xs text-emerald-600">{message}</p>}
            </div>
        );
    }

    return (
        <div className={`mt-3 space-y-3 rounded-md border border-orange-200 bg-orange-50/60 p-4 ${className}`}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(260px,0.9fr)_minmax(480px,1.5fr)]">
                <Combobox
                    options={customerOptions}
                    value={customerId}
                    onChange={(value) => handleCustomerChange(value)}
                    label="거래처"
                    placeholder="거래처명 또는 코드 입력"
                    emptyText="일치하는 거래처가 없습니다"
                    disabled={isPending}
                    showAllOnFocus
                />

                <Combobox
                    options={addressOptions}
                    value={addressId}
                    onChange={(value) => {
                        setAddressId(value);
                        setMessage(null);
                    }}
                    label="도착지"
                    placeholder={customerId ? '도착지명, 주소, 전화번호 입력' : '거래처를 먼저 선택'}
                    emptyText="일치하는 도착지가 없습니다"
                    disabled={isPending || !customerId}
                    showAllOnFocus
                    dropdownClassName="md:min-w-[680px]"
                    optionLabelClassName="min-w-0 whitespace-normal break-keep"
                />
            </div>

            <input
                type="text"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={isPending}
                placeholder="수정 사유 메모"
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />

            {message && <p className="text-xs text-red-600">{message}</p>}

            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={save}
                    disabled={isPending || !hasChanged || !addressId}
                    className="rounded-md bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                    {isPending ? '저장 중' : '저장'}
                </button>
                <button
                    type="button"
                    onClick={reset}
                    disabled={isPending}
                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    취소
                </button>
            </div>
        </div>
    );
}
