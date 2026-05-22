const fs = require('fs');
const filePath = 'C:\\website\\hanyangpetro-ops\\src\\app\\admin\\orders\\[id]\\page.tsx';
let text = fs.readFileSync(filePath, 'utf8');

const old1 = "const canStartHanwhaOrder = session.user.name === '\uC591\uD76C\uCCA0';";
const new1 = "const canStartHanwhaOrder = session.user.userKind === 'staff';";
console.log('old1 found:', text.includes(old1));
text = text.split(old1).join(new1);

const old2 = "const isInternalPurchaseOnly = normalizeCompanyName(order.customer.companyName) === '\uD55C\uC591\uC720\uD654';";
const addition = "\n    const hasNonHanwhaSupplier = order.items.some((item) => {\n        const name = item.purchaseSupplier?.supplierName ?? '';\n        return name !== '' && !name.includes('\uD55C\uD654');\n    });\n    const isDispatchWaiting = order.status === 'DISPATCH_WAITING';";
console.log('old2 found:', text.includes(old2));
text = text.split(old2).join(old2 + addition);

fs.writeFileSync(filePath, text, 'utf8');
console.log('done');
