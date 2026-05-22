const fs = require('fs');
const path = 'C:\\website\\hanyangpetro-ops\\src\\app\\admin\\orders\\[id]\\page.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Remove duplicate hasNonHanwhaSupplier + isDispatchWaiting declarations (second occurrence)
const dupPattern = /\n    const hasNonHanwhaSupplier = order\.items\.some\(\(item\) => \{\n        const name = item\.purchaseSupplier\?\.supplierName \?\? '';\n        return name !== '' && !name\.includes\('한화'\);\n    \}\);\n    const isDispatchWaiting = order\.status === 'DISPATCH_WAITING';\n\n    \/\/ 거래처/;
const replacement = '\n\n    // 거래처';
const fixed1 = content.replace(dupPattern, replacement);
if (fixed1 === content) {
    console.log('WARNING: duplicate pattern not found, trying alternative...');
    // Try removing just one of the duplicate blocks
    const occurrences = [];
    let idx = 0;
    const searchStr = "    const hasNonHanwhaSupplier = order.items.some((item) => {";
    while ((idx = content.indexOf(searchStr, idx)) !== -1) {
        occurrences.push(idx);
        idx += searchStr.length;
    }
    console.log('Found hasNonHanwhaSupplier at positions:', occurrences);
} else {
    console.log('Removed duplicate hasNonHanwhaSupplier + isDispatchWaiting declarations');
    content = fixed1;
}

// 2. Fix MissingDispatchBackorderForm missing closing }
// Find: {isDispatchWaiting && <MissingDispatchBackorderForm ... />  (no closing })
// Before: {/* 주문 품목 */}
const missingClose = /(\{isDispatchWaiting && <MissingDispatchBackorderForm[\s\S]*?\/\>)\s*\n(\s*\{\/\* 주문 품목)/;
const match = content.match(missingClose);
if (match) {
    content = content.replace(missingClose, '$1}\n\n$2');
    console.log('Fixed MissingDispatchBackorderForm closing }');
} else {
    console.log('WARNING: MissingDispatchBackorderForm close pattern not found');
    // Let's look at what's around it
    const idx = content.indexOf('MissingDispatchBackorderForm');
    if (idx !== -1) {
        console.log('Context around MissingDispatchBackorderForm:');
        console.log(JSON.stringify(content.slice(idx - 20, idx + 300)));
    }
}

fs.writeFileSync(path, content, 'utf8');
console.log('Done.');
