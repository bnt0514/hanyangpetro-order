'use client';



type RangeTarget = 'a' | 'b' | 'pattern';

const fieldNames: Record<RangeTarget, { from: string; to: string }> = {
    a: { from: 'aFrom', to: 'aTo' },
    b: { from: 'bFrom', to: 'bTo' },
    pattern: { from: 'patternFrom', to: 'patternTo' },
};

function iso(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthRange(fromIso: string, offset: number) {
    const base = new Date(`${fromIso}T00:00:00`);
    const first = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    const last = new Date(base.getFullYear(), base.getMonth() + offset + 1, 0);
    return { from: iso(first), to: iso(last) };
}

export default function PerformanceRangeButtons({ target, from }: { target: RangeTarget; from: string }) {
    const names = fieldNames[target];

    function move(offset: number) {
        const fromInput = document.querySelector<HTMLInputElement>(`input[name="${names.from}"]`);
        const toInput = document.querySelector<HTMLInputElement>(`input[name="${names.to}"]`);
        const currentFrom = fromInput?.value || from;
        const next = monthRange(currentFrom, offset);
        if (fromInput) fromInput.value = next.from;
        if (toInput) toInput.value = next.to;
    }

    return (
        <div className="mb-2 flex gap-1.5">
            <button type="button" onClick={() => move(-1)} className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
                1개월전
            </button>
            <button type="button" onClick={() => move(1)} className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
                1개월후
            </button>
        </div>
    );
}
