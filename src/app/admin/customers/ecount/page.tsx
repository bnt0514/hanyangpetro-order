import { auth } from '@/lib/auth';
import {
    loadEcountCustomers,
    normalizeBusinessNumber,
    normalizeEcountCustomerName,
    type EcountCustomerMatch,
    type EcountCustomerMatchIndex,
} from '@/lib/ecount-customers';
import { prisma } from '@/lib/db';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileSpreadsheet, Search } from 'lucide-react';

export const dynamic = 'force-dynamic';

function recentIso(...dates: Array<Date | null | undefined>) {
    const recent = dates
        .filter((date): date is Date => !!date)
        .sort((a, b) => b.getTime() - a.getTime())[0];
    return recent?.toISOString() ?? null;
}

function newerMatch(a: EcountCustomerMatch | undefined, b: EcountCustomerMatch) {
    if (!a) return b;
    const at = a.recentTransactionDate ? new Date(a.recentTransactionDate).getTime() : 0;
    const bt = b.recentTransactionDate ? new Date(b.recentTransactionDate).getTime() : 0;
    return bt > at ? b : a;
}

function fmtDate(value: string | null) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function matchLabel(type: EcountCustomerMatch['matchType']) {
    if (type === 'BUSINESS_NUMBER') return '사업자번호';
    if (type === 'EXACT_NAME') return '이름일치';
    return '정규화일치';
}

async function buildEcountCustomerMatchIndex(): Promise<EcountCustomerMatchIndex> {
    const [customers, ledgerMaxRows, orderMaxRows] = await Promise.all([
        prisma.customer.findMany({
            select: {
                id: true,
                customerCode: true,
                companyName: true,
                businessNumber: true,
            },
        }),
        prisma.ledgerEntry.groupBy({
            by: ['customerId'],
            where: { customerId: { not: null } },
            _max: { transactionDate: true },
        }),
        prisma.order.groupBy({
            by: ['customerId'],
            where: {
                deletedAt: null,
                requestedDeliveryDate: { not: null },
            },
            _max: { requestedDeliveryDate: true },
        }),
    ]);

    const ledgerByCustomerId = new Map(ledgerMaxRows.map((row) => [row.customerId, row._max.transactionDate]));
    const orderByCustomerId = new Map(orderMaxRows.map((row) => [row.customerId, row._max.requestedDeliveryDate]));
    const index: EcountCustomerMatchIndex = {
        byBusinessNumber: {},
        byExactName: {},
        byNormalizedName: {},
    };

    for (const customer of customers) {
        const match: EcountCustomerMatch = {
            homepageCustomerId: customer.id,
            homepageCustomerCode: customer.customerCode,
            homepageCompanyName: customer.companyName,
            matchType: 'NORMALIZED_NAME',
            recentTransactionDate: recentIso(
                ledgerByCustomerId.get(customer.id),
                orderByCustomerId.get(customer.id),
            ),
        };
        const exact = customer.companyName.trim();
        if (exact) {
            index.byExactName[exact] = newerMatch(index.byExactName[exact], { ...match, matchType: 'EXACT_NAME' });
        }

        const normalizedName = normalizeEcountCustomerName(customer.companyName);
        if (normalizedName) {
            index.byNormalizedName[normalizedName] = newerMatch(index.byNormalizedName[normalizedName], match);
        }

        const businessNumber = normalizeBusinessNumber(customer.businessNumber ?? '');
        if (businessNumber.length >= 10) {
            index.byBusinessNumber[businessNumber] = newerMatch(index.byBusinessNumber[businessNumber], { ...match, matchType: 'BUSINESS_NUMBER' });
        }
    }

    return index;
}

export default async function EcountCustomersPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string }>;
}) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const { q = '' } = await searchParams;
    const query = q.trim();
    const matchIndex = await buildEcountCustomerMatchIndex();
    const lookup = loadEcountCustomers(query, 300, matchIndex);
    const totalCount = loadEcountCustomers('').totalCount;

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
                    <Link href="/admin/customers" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
                        <ArrowLeft size={14} /> 거래처 관리
                    </Link>
                    <div className="text-right text-xs text-slate-400">
                        <div>이카운트거래처.xlsx 기준 내장 데이터</div>
                        <div>전체 {totalCount.toLocaleString('ko-KR')}건 · 최근 거래순</div>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-6xl space-y-5 p-6">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800">
                            <FileSpreadsheet size={24} /> 이카운트 거래처정보
                        </h1>
                        <p className="mt-1 text-sm text-slate-500">
                            엑셀 기준 거래처 정보를 홈페이지에 내장해 두고, 홈페이지 거래처와 매칭되는 최근 거래처를 위로 표시합니다.
                        </p>
                    </div>
                    <form className="flex items-center gap-2">
                        <input
                            name="q"
                            defaultValue={query}
                            placeholder="거래처명/사업자번호/주소/전화 검색"
                            className="w-80 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                        />
                        <button className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                            <Search size={15} /> 검색
                        </button>
                    </form>
                </div>

                <div className="flex items-center justify-between text-sm text-slate-500">
                    <span>
                        {query ? `검색 결과 ${lookup.totalCount.toLocaleString('ko-KR')}건` : `전체 ${lookup.totalCount.toLocaleString('ko-KR')}건`}
                    </span>
                    {lookup.totalCount > lookup.rows.length && (
                        <span>상위 {lookup.rows.length.toLocaleString('ko-KR')}건만 표시 중입니다. 검색어를 더 좁혀주세요.</span>
                    )}
                </div>

                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1320px] text-sm">
                            <thead>
                                <tr className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
                                    <th className="px-4 py-3">행</th>
                                    <th className="px-4 py-3">사업자번호/코드</th>
                                    <th className="px-4 py-3">거래처명</th>
                                    <th className="px-4 py-3">대표자</th>
                                    <th className="px-4 py-3">전화</th>
                                    <th className="px-4 py-3">주소</th>
                                    <th className="px-4 py-3">Email</th>
                                    <th className="px-4 py-3">담당자</th>
                                    <th className="px-4 py-3">홈페이지 매칭</th>
                                    <th className="px-4 py-3">최근거래</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {lookup.rows.map((row) => (
                                    <tr key={`${row.rowNumber}-${row.businessNumberCode}-${row.companyName}`} className="hover:bg-emerald-50/40">
                                        <td className="px-4 py-3 font-mono text-xs text-slate-400">{row.rowNumber}</td>
                                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{row.businessNumberCode || '-'}</td>
                                        <td className="px-4 py-3 font-semibold text-slate-800">{row.companyName || '-'}</td>
                                        <td className="px-4 py-3 text-slate-600">{row.ceoName || '-'}</td>
                                        <td className="px-4 py-3 text-slate-600">{row.phone || '-'}</td>
                                        <td className="px-4 py-3 text-slate-600">{row.address || '-'}</td>
                                        <td className="px-4 py-3 text-slate-600">{row.email || '-'}</td>
                                        <td className="px-4 py-3 text-slate-600">{row.managerName || '-'}</td>
                                        <td className="px-4 py-3">
                                            {row.match ? (
                                                <div>
                                                    <div className="font-semibold text-slate-800">{row.match.homepageCompanyName}</div>
                                                    <div className="text-xs text-slate-400">
                                                        {matchLabel(row.match.matchType)} · {row.match.homepageCustomerCode}
                                                    </div>
                                                </div>
                                            ) : (
                                                <span className="text-slate-300">미매칭</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{fmtDate(row.match?.recentTransactionDate ?? null)}</td>
                                    </tr>
                                ))}
                                {lookup.rows.length === 0 && (
                                    <tr>
                                        <td colSpan={10} className="px-5 py-12 text-center text-sm text-slate-400">
                                            조회된 이카운트 거래처 정보가 없습니다.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </main>
        </div>
    );
}
