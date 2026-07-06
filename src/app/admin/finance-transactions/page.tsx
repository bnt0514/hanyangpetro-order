import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, WalletCards } from 'lucide-react';
import FinanceTransactionClient from './FinanceTransactionClient';
import { canViewAllStaffData } from '@/lib/staff-permissions';

export const dynamic = 'force-dynamic';

type Search = {
    from?: string;
    to?: string;
    q?: string;
    txType?: string;
};

function pad2(value: number) {
    return String(value).padStart(2, '0');
}

function dateToIso(date: Date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function defaultRange() {
    const today = new Date();
    return {
        from: `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-01`,
        to: dateToIso(today),
    };
}

function parseDate(value: string) {
    return new Date(`${value}T00:00:00`);
}

function addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function money(value: number) {
    return `${value.toLocaleString('ko-KR')}원`;
}

export default async function FinanceTransactionsPage({ searchParams }: { searchParams: Promise<Search> }) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');
    if (!canViewAllStaffData(session.user)) redirect('/admin');

    const sp = await searchParams;
    const fallback = defaultRange();
    const from = sp.from || fallback.from;
    const to = sp.to || fallback.to;
    const q = (sp.q ?? '').trim();
    const txType = ['IN', 'PAYMENT', 'NOTE_IN', 'NOTE_TRANSFER', 'NOTE_DECREASE'].includes(sp.txType ?? '') ? sp.txType! : '';
    const fromDate = parseDate(from);
    const toExclusive = addDays(parseDate(to), 1);
    const baseWhere = {
        txType: txType ? txType : { in: ['IN', 'PAYMENT', 'NOTE_IN', 'NOTE_TRANSFER', 'NOTE_DECREASE'] },
        txDate: { gte: fromDate, lt: toExclusive },
        ...(q ? {
            OR: [
                { customer: { companyName: { contains: q } } },
                { supplier: { supplierName: { contains: q } } },
                { memo: { contains: q } },
                { noteNumber: { contains: q } },
                { noteIssuer: { contains: q } },
                { noteDescription: { contains: q } },
            ],
        } : {}),
    };

    const [rows, customers, suppliers, totals, noteTransactions] = await Promise.all([
        prisma.creditTransaction.findMany({
            where: baseWhere,
            include: {
                customer: { select: { id: true, companyName: true } },
                supplier: { select: { id: true, supplierName: true } },
            },
            orderBy: [{ txDate: 'desc' }, { createdAt: 'desc' }],
            take: 500,
        }),
        prisma.customer.findMany({
            where: { isActive: true },
            select: { id: true, companyName: true },
            orderBy: { companyName: 'asc' },
        }),
        prisma.supplier.findMany({
            where: { isActive: true },
            select: { id: true, supplierName: true },
            orderBy: { supplierName: 'asc' },
        }),
        prisma.creditTransaction.groupBy({
            by: ['txType'],
            where: baseWhere,
            _sum: { amount: true },
        }),
        prisma.creditTransaction.findMany({
            where: {
                txType: { in: ['NOTE_IN', 'NOTE_TRANSFER', 'NOTE_DECREASE'] },
                noteNumber: { not: null },
            },
            include: {
                customer: { select: { companyName: true } },
            },
            orderBy: [{ txDate: 'desc' }, { createdAt: 'desc' }],
        }),
    ]);

    const depositTotal = (totals.find((item) => item.txType === 'IN')?._sum.amount ?? 0) + (totals.find((item) => item.txType === 'NOTE_IN')?._sum.amount ?? 0);
    const paymentTotal = (totals.find((item) => item.txType === 'PAYMENT')?._sum.amount ?? 0) + (totals.find((item) => item.txType === 'NOTE_TRANSFER')?._sum.amount ?? 0);
    const serializedRows = rows.map((row) => ({
        id: row.id,
        txDate: dateToIso(row.txDate),
        txType: row.txType,
        amount: row.amount,
        memo: row.memo,
        source: row.source,
        customerId: row.customer?.id ?? null,
        customerName: row.customer?.companyName ?? null,
        supplierId: row.supplier?.id ?? null,
        supplierName: row.supplier?.supplierName ?? null,
        noteNumber: row.noteNumber,
        noteMaturityDate: row.noteMaturityDate ? dateToIso(row.noteMaturityDate) : null,
        noteIssuer: row.noteIssuer,
        noteDescription: row.noteDescription,
    }));
    const noteMap = new Map<string, {
        id: string;
        txDate: string;
        customerName: string | null;
        amount: number;
        transferredAmount: number;
        noteNumber: string;
        noteMaturityDate: string | null;
        noteIssuer: string | null;
        noteDescription: string | null;
    }>();
    for (const row of noteTransactions) {
        const noteNumber = row.noteNumber?.trim();
        if (!noteNumber) continue;
        const existing = noteMap.get(noteNumber);
        if (row.txType === 'NOTE_IN') {
            if (existing) {
                existing.amount += row.amount;
                existing.customerName = existing.customerName ?? row.customer?.companyName ?? null;
                existing.noteMaturityDate = existing.noteMaturityDate ?? (row.noteMaturityDate ? dateToIso(row.noteMaturityDate) : null);
                existing.noteIssuer = existing.noteIssuer ?? row.noteIssuer;
                existing.noteDescription = existing.noteDescription ?? row.noteDescription;
                if (row.txDate > new Date(`${existing.txDate}T00:00:00`)) {
                    existing.id = row.id;
                    existing.txDate = dateToIso(row.txDate);
                    existing.customerName = row.customer?.companyName ?? existing.customerName;
                    existing.noteMaturityDate = row.noteMaturityDate ? dateToIso(row.noteMaturityDate) : existing.noteMaturityDate;
                    existing.noteIssuer = row.noteIssuer ?? existing.noteIssuer;
                    existing.noteDescription = row.noteDescription ?? existing.noteDescription;
                }
            } else {
                noteMap.set(noteNumber, {
                    id: row.id,
                    txDate: dateToIso(row.txDate),
                    customerName: row.customer?.companyName ?? null,
                    amount: row.amount,
                    transferredAmount: 0,
                    noteNumber,
                    noteMaturityDate: row.noteMaturityDate ? dateToIso(row.noteMaturityDate) : null,
                    noteIssuer: row.noteIssuer,
                    noteDescription: row.noteDescription,
                });
            }
        } else if (existing) {
            existing.transferredAmount += row.amount;
        } else {
            noteMap.set(noteNumber, {
                id: row.id,
                txDate: dateToIso(row.txDate),
                customerName: null,
                amount: 0,
                transferredAmount: row.amount,
                noteNumber,
                noteMaturityDate: row.noteMaturityDate ? dateToIso(row.noteMaturityDate) : null,
                noteIssuer: row.noteIssuer,
                noteDescription: row.noteDescription,
            });
        }
    }
    const noteReceipts = Array.from(noteMap.values())
        .map((note) => ({ ...note, remainingAmount: note.amount - note.transferredAmount }))
        .filter((note) => note.amount > 0 && note.remainingAmount > 0)
        .sort((a, b) => b.txDate.localeCompare(a.txDate));

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
                    <Link href="/admin/ledger" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> 원장 통합 조회</Link>
                    <span className="text-sm text-slate-500">{session.user.name}</span>
                </div>
            </header>
            <main className="mx-auto max-w-7xl space-y-4 p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <WalletCards className="text-emerald-600" size={24} />
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800">입출금 등록</h1>
                            <p className="mt-1 text-sm text-slate-500">입금, 출금, 어음 수취와 지급을 등록하고 일자, 기간, 업체별로 확인합니다.</p>
                        </div>
                    </div>
                    <Link href="/admin/ledger" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">입출금 업데이트</Link>
                </div>

                <form className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-end gap-2">
                        <div>
                            <label className="mb-1 block text-xs font-semibold text-slate-500">시작</label>
                            <input name="from" type="date" defaultValue={from} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-semibold text-slate-500">종료</label>
                            <input name="to" type="date" defaultValue={to} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-semibold text-slate-500">구분</label>
                            <select name="txType" defaultValue={txType} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                                <option value="">전체</option>
                                <option value="IN">입금</option>
                                <option value="PAYMENT">출금</option>
                                <option value="NOTE_IN">어음수취</option>
                                <option value="NOTE_TRANSFER">어음지급</option>
                                <option value="NOTE_DECREASE">어음감소</option>
                            </select>
                        </div>
                        <div className="min-w-64 flex-1">
                            <label className="mb-1 block text-xs font-semibold text-slate-500">업체/메모</label>
                            <input name="q" defaultValue={q} placeholder="업체명 또는 메모" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                        </div>
                        <button className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800">조회</button>
                    </div>
                </form>

                <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-emerald-700">기간 입금 합계</p>
                        <p className="mt-1 text-xl font-bold text-slate-900">{money(depositTotal)}</p>
                    </div>
                    <div className="rounded-2xl border border-rose-100 bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-rose-700">기간 출금 합계</p>
                        <p className="mt-1 text-xl font-bold text-slate-900">{money(paymentTotal)}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold text-slate-500">조회 건수</p>
                        <p className="mt-1 text-xl font-bold text-slate-900">{rows.length.toLocaleString('ko-KR')}건</p>
                    </div>
                </div>

                <FinanceTransactionClient rows={serializedRows} customers={customers} suppliers={suppliers} noteReceipts={noteReceipts} />
            </main>
        </div>
    );
}
