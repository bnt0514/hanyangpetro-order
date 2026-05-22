const fs = require('fs');
const path = 'C:\\website\\hanyangpetro-ops\\src\\app\\admin\\orders\\[id]\\page.tsx';
let content = fs.readFileSync(path, 'utf8');

// Remove the second occurrence of hasNonHanwhaSupplier block (positions 5709 and 5962)
// We'll find the second occurrence and remove from there back to the first's end

const searchStr = "    const hasNonHanwhaSupplier = order.items.some((item) => {";
const idx1 = content.indexOf(searchStr);
const idx2 = content.indexOf(searchStr, idx1 + 1);
console.log('First at:', idx1, 'Second at:', idx2);

if (idx2 !== -1) {
    // Find end of the second block: ends after isDispatchWaiting line
    const endSearch = "    const isDispatchWaiting = order.status === 'DISPATCH_WAITING';\n";
    const endIdx = content.indexOf(endSearch, idx2);
    if (endIdx !== -1) {
        const removeEnd = endIdx + endSearch.length;
        content = content.slice(0, idx2) + content.slice(removeEnd);
        console.log('Removed second duplicate block');
    } else {
        console.log('Could not find end of second block');
    }
} else {
    console.log('No second occurrence found - already fixed!');
}

fs.writeFileSync(path, content, 'utf8');
console.log('Done. Checking occurrences now:');
const count = (content.match(/const hasNonHanwhaSupplier/g) || []).length;
console.log('hasNonHanwhaSupplier count:', count);
