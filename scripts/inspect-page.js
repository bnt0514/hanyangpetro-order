const fs = require('fs');
const filePath = 'C:\\website\\hanyangpetro-ops\\src\\app\\admin\\orders\\[id]\\page.tsx';
let text = fs.readFileSync(filePath, 'utf8');

const startIdx = text.indexOf('isDispatchWaiting && <MissingDispatch');
const snippet = text.substring(startIdx, startIdx + 400);
// Show hex of newlines
const bytes = Buffer.from(snippet, 'utf8');
let hex = '';
for (let i = 0; i < Math.min(bytes.length, 300); i++) {
    hex += bytes[i].toString(16).padStart(2, '0') + ' ';
}
console.log(hex);
console.log('---');
// also show the snippet with visible newlines
console.log(JSON.stringify(snippet.substring(0, 300)));
