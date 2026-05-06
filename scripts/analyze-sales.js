/**
 * 거래처별 월별매출 엑셀 분석 → 여신한도 제안
 * 기준: 월평균 매출 × 2.0 (기본 두 달치 리스크)
 */
const xlsx = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'data', '거래처별월별매출.xlsx');
const wb = xlsx.readFile(filePath);

console.log('시트 목록:', wb.SheetNames);
console.log('');

const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });

// 원본 데이터 미리보기 (첫 5행)
console.log('=== 원본 데이터 미리보기 (첫 5행) ===');
rows.slice(0, 5).forEach((r, i) => console.log(`[${i}]`, JSON.stringify(r)));
console.log('...');
console.log('총 행수:', rows.length);
