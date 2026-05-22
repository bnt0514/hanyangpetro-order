const fs = require('fs');
const filePath = 'C:\\website\\hanyangpetro-ops\\src\\app\\admin\\orders\\[id]\\page.tsx';
let text = fs.readFileSync(filePath, 'utf8');

// MissingDispatchBackorderForm 닫기: />  \n\n  {/* 주문 품목 */} 패턴
// 현재: />  \n\n  {/* 주문 품목
// 목표: />}\n\n  {/* 주문 품목
const marker = '                />\n\n                {/* \354\243\274\353\254\270 \355\222\210\353\252\251 */}';
console.log('marker (utf8 escaped) found:', text.includes('                />\n\n                {/* 주문 품목 */}'));

// Find the position after MissingDispatchBackorderForm's />
const searchFrom = text.indexOf('isDispatchWaiting && <MissingDispatch');
const closingIdx = text.indexOf('                />\n\n                {/* 주문 품목', searchFrom);
console.log('closingIdx:', closingIdx);
if (closingIdx >= 0) {
    // replace />  \n\n  {/* with />}\n\n  {/*
    text = text.substring(0, closingIdx) + '                />}\n\n                {/* 주문 품목' + text.substring(closingIdx + '                />\n\n                {/* 주문 품목'.length);
    console.log('replaced closing');
}

fs.writeFileSync(filePath, text, 'utf8');
console.log('done');
