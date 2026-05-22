'use client';

import { ExternalLink } from 'lucide-react';

type Props = {
    salesHref?: string;
    purchaseHref?: string;
    mode: 'sales' | 'purchase' | 'compare';
};

function openPopup(url: string, name: string, left: number, width: number) {
    const height = Math.max(720, Math.floor(window.screen.availHeight * 0.9));
    const top = 20;
    window.open(
        url,
        name,
        `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,noopener=no,noreferrer=no`,
    );
}

export default function LedgerPopupButtons({ salesHref, purchaseHref, mode }: Props) {
    function open() {
        const screenWidth = window.screen.availWidth || 1440;
        const halfWidth = Math.max(720, Math.floor(screenWidth / 2));

        if (mode === 'compare') {
            if (salesHref) openPopup(salesHref, 'sales-ledger-popup', 0, halfWidth);
            if (purchaseHref) openPopup(purchaseHref, 'purchase-ledger-popup', halfWidth, halfWidth);
            return;
        }

        if (mode === 'sales' && salesHref) openPopup(salesHref, 'sales-ledger-popup', 0, halfWidth);
        if (mode === 'purchase' && purchaseHref) openPopup(purchaseHref, 'purchase-ledger-popup', halfWidth, halfWidth);
    }

    return (
        <button
            type="button"
            onClick={open}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
            {mode === 'compare' ? '좌우 팝업' : '팝업'} <ExternalLink size={12} />
        </button>
    );
}
