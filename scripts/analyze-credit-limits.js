/**
 * 거래처별 월별매출 엑셀 분석 → 여신한도 제안
 * 기준: 월평균 매출 × 2.0 (기본 두 달치 리스크)
 * 출력: data/credit-limits-proposed.json
 */
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'data', '거래처별월별매출.xlsx');
const wb = xlsx.readFile(filePath);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });

// 헤더 행 = row[1]
const header = rows[1];
// 월 컬럼 인덱스 (2~11 → 10개월)
const monthCols = header.slice(2, 12); // ['2025.6', ...]
const DATA_START = 2;

const results = [];

for (let i = DATA_START; i < rows.length; i++) {
    const row = rows[i];
    const code = String(row[0] || '').trim();
    const name = String(row[1] || '').trim();
    if (!code || !name) continue;

    const monthlySales = monthCols.map((m, idx) => ({
        month: m,
        amount: Number(row[2 + idx]) || 0,
    }));

    const activeMonths = monthlySales.filter(m => m.amount > 0);
    const total = monthlySales.reduce((s, m) => s + m.amount, 0);
    const avgMonthly = activeMonths.length > 0 ? total / activeMonths.length : 0;
    const proposedLimit = Math.ceil((avgMonthly * 2) / 1000000) * 1000000; // 백만 단위 올림

    const maxMonth = monthlySales.reduce((a, b) => (b.amount > a.amount ? b : a), monthlySales[0]);
    const minActiveMonth = activeMonths.length > 0
        ? activeMonths.reduce((a, b) => (b.amount < a.amount ? b : a), activeMonths[0])
        : null;

    results.push({
        customerCode: code,
        customerName: name,
        monthlySales,
        activeMonthCount: activeMonths.length,
        totalSales: total,
        avgMonthlySales: Math.round(avgMonthly),
        proposedCreditLimit: proposedLimit,
        maxMonth: maxMonth.month,
        maxSales: maxMonth.amount,
        minActiveMonth: minActiveMonth ? minActiveMonth.month : null,
        minActiveSales: minActiveMonth ? minActiveMonth.amount : null,
        creditRiskTier: 'STANDARD', // 기본값; 별도로 조정 필요
        note: '',
    });
}

// 정렬: 제안한도 내림차순
results.sort((a, b) => b.proposedCreditLimit - a.proposedCreditLimit);

// JSON 저장
const outPath = path.join(__dirname, '..', 'data', 'credit-limits-proposed.json');
fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
console.log(`✅ ${results.length}개 거래처 분석 완료 → ${outPath}\n`);

// 콘솔 요약 테이블
console.log(
    '순위'.padEnd(4),
    '거래처명'.padEnd(20),
    '활성월수'.padEnd(6),
    '월평균매출'.padEnd(14),
    '제안여신한도'.padEnd(14),
);
console.log('-'.repeat(70));

results.forEach((r, idx) => {
    const avg = r.avgMonthlySales.toLocaleString('ko-KR');
    const limit = r.proposedCreditLimit.toLocaleString('ko-KR');
    console.log(
        String(idx + 1).padEnd(4),
        r.customerName.slice(0, 18).padEnd(20),
        String(r.activeMonthCount).padEnd(6),
        avg.padStart(14),
        limit.padStart(14),
    );
});

// 전체 통계
const totalProposedLimit = results.reduce((s, r) => s + r.proposedCreditLimit, 0);
console.log('\n=== 전체 통계 ===');
console.log(`거래처 수: ${results.length}개`);
console.log(`제안 여신한도 합계: ${totalProposedLimit.toLocaleString('ko-KR')}원`);
console.log(`평균 여신한도: ${Math.round(totalProposedLimit / results.length).toLocaleString('ko-KR')}원`);
console.log(`\n10개월 전체 기간 활성 거래처: ${results.filter(r => r.activeMonthCount === 10).length}개`);
console.log(`비활성(0원) 거래처: ${results.filter(r => r.activeMonthCount === 0).length}개`);
