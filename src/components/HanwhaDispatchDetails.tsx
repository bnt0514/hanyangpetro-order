import { Truck } from 'lucide-react';
import { fmtNumber } from '@/lib/orders';

export type HanwhaDispatchDetailRow = {
    id: string;
    materialNameRaw: string | null;
    materialName: string | null;
    quantityTon: number | null;
    driverInfo: string;
};

export default function HanwhaDispatchDetails({
    rows,
    orderQuantityTon,
}: {
    rows: HanwhaDispatchDetailRow[];
    orderQuantityTon?: number;
}) {
    if (rows.length === 0) return null;
    const shippedQuantityTon = rows.reduce((sum, row) => sum + (row.quantityTon ?? 0), 0);
    const remainingQuantityTon = orderQuantityTon == null ? null : orderQuantityTon - shippedQuantityTon;
    const hasMismatch = remainingQuantityTon != null && Math.abs(remainingQuantityTon) > 0.0001;

    return (
        <section className="bg-white rounded-2xl border border-cyan-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-cyan-100 bg-cyan-50/60 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                    <Truck size={16} className="text-cyan-700" />
                    <h2 className="font-semibold text-slate-800">배차내역</h2>
                </div>
                <span className="text-xs text-cyan-700">라인 {rows.length}건</span>
            </div>
            {orderQuantityTon != null && (
                <div className={`px-6 py-3 text-xs border-b ${hasMismatch ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-cyan-100 bg-white text-slate-500'}`}>
                    주문수량 {fmtNumber(orderQuantityTon)} TON · 출고수량 {fmtNumber(shippedQuantityTon)} TON
                    {hasMismatch && (
                        <span className="ml-2 font-semibold">
                            미출고/차이 {fmtNumber(remainingQuantityTon)} TON
                        </span>
                    )}
                </div>
            )}
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-white text-left text-xs font-medium text-slate-500 uppercase">
                            <th className="px-6 py-3 w-10">#</th>
                            <th className="px-6 py-3">자재명</th>
                            <th className="px-6 py-3">한양 표기</th>
                            <th className="px-6 py-3 text-right">수량(TON)</th>
                            <th className="px-6 py-3">기사정보</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.map((row, index) => (
                            <tr key={row.id}>
                                <td className="px-6 py-3 text-xs text-slate-400">{index + 1}</td>
                                <td className="px-6 py-3 text-xs font-mono text-slate-600">
                                    {row.materialNameRaw ?? '-'}
                                </td>
                                <td className="px-6 py-3 font-medium text-slate-800">
                                    {row.materialName ?? '-'}
                                </td>
                                <td className="px-6 py-3 text-right text-slate-700">
                                    {row.quantityTon != null ? fmtNumber(row.quantityTon) : '-'}
                                </td>
                                <td className="px-6 py-3 text-xs text-slate-600">{row.driverInfo}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}