const fs = require('fs');
const path = 'C:\\website\\hanyangpetro-ops\\src\\app\\admin\\orders\\[id]\\page.tsx';
let content = fs.readFileSync(path, 'utf8');

const searchStr = "    const hasNonHanwhaSupplier = order.items.some((item) => {";
const idx2 = content.indexOf(searchStr, content.indexOf(searchStr) + 1);
console.log('Second at:', idx2);
console.log('Context:', JSON.stringify(content.slice(idx2, idx2 + 300)));
