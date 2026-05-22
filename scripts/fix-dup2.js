const fs = require('fs');
const path = 'C:\\website\\hanyangpetro-ops\\src\\app\\admin\\orders\\[id]\\page.tsx';
let content = fs.readFileSync(path, 'utf8');

const searchStr = "    const hasNonHanwhaSupplier = order.items.some((item) => {";
const idx1 = content.indexOf(searchStr);
const idx2 = content.indexOf(searchStr, idx1 + 1);

// The second block ends with DISPATCH_WAITING';\r\n\r\n
const endSearch = "    const isDispatchWaiting = order.status === 'DISPATCH_WAITING';\r\n\r\n";
const endIdx = content.indexOf(endSearch, idx2);
console.log('endIdx:', endIdx);
if (endIdx !== -1) {
    const removeEnd = endIdx + endSearch.length;
    content = content.slice(0, idx2) + content.slice(removeEnd);
    console.log('Removed second duplicate block');
    console.log('hasNonHanwhaSupplier count:', (content.match(/const hasNonHanwhaSupplier/g) || []).length);
    fs.writeFileSync(path, content, 'utf8');
} else {
    console.log('FAILED');
}
