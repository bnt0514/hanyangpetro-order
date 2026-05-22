const fs = require('fs');
const filePath = 'C:\\website\\hanyangpetro-ops\\src\\app\\admin\\orders\\[id]\\page.tsx';
let text = fs.readFileSync(filePath, 'utf8');

// 1. ManualDispatchForm: hasNonHanwhaSupplier일 때만 표시
const oldManual = `                <ManualDispatchForm orderId={order.id} />`;
const newManual = `                {hasNonHanwhaSupplier && <ManualDispatchForm orderId={order.id} />}`;
console.log('ManualDispatchForm found:', text.includes(oldManual));
text = text.split(oldManual).join(newManual);

// 2. MissingDispatchBackorderForm: isDispatchWaiting일 때만 표시
const oldMissing = `                <MissingDispatchBackorderForm`;
const newMissing = `                {isDispatchWaiting && <MissingDispatchBackorderForm`;
console.log('MissingDispatchBackorderForm found:', text.includes(oldMissing));
// MissingDispatchBackorderForm의 닫는 태그도 찾아서 수정
text = text.split(oldMissing).join(newMissing);

// closing /> of MissingDispatchBackorderForm - find it
// It ends with />  followed by newline and empty lines or next section
// We need to add } after the last />
const oldClose = `                />

                {/* 주문 품목 */}`;
const newClose = `                />}

                {/* 주문 품목 */}`;
console.log('MissingDispatch close found:', text.includes(oldClose));
text = text.split(oldClose).join(newClose);

fs.writeFileSync(filePath, text, 'utf8');
console.log('done');
console.log('hasNonHanwha in JSX:', text.includes('hasNonHanwhaSupplier && <ManualDispatchForm'));
console.log('isDispatchWaiting in JSX:', text.includes('isDispatchWaiting && <MissingDispatchBackorderForm'));
