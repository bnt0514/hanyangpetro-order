path = r'C:\website\hanyangpetro-ops\src\app\admin\orders\[id]\page.tsx'
with open(path, 'rb') as f:
    data = f.read()
text = data.decode('utf-8')

# 1. canStartHanwhaOrder: 모든 직원으로 변경
old1 = "const canStartHanwhaOrder = session.user.name === '양희철';"
new1 = "const canStartHanwhaOrder = session.user.userKind === 'staff';"
count1 = text.count(old1)
text = text.replace(old1, new1)
print(f'1. replaced {count1} occurrences of canStartHanwhaOrder')

# 2. isInternalPurchaseOnly 이후에 새 변수 추가
old2 = "const isInternalPurchaseOnly = normalizeCompanyName(order.customer.companyName) === '한양유화';"
new2 = """const isInternalPurchaseOnly = normalizeCompanyName(order.customer.companyName) === '한양유화';
    // 수기배차 폼: 매입처 중 한화솔루션이 아닌 것이 포함된 경우에만 표시
    const hasNonHanwhaSupplier = order.items.some((item) => {
        const name = item.purchaseSupplier?.supplierName ?? '';
        return name !== '' && !name.includes('한화');
    });
    // 미배차/백오더: DISPATCH_WAITING 상태일 때만
    const isDispatchWaiting = order.status === 'DISPATCH_WAITING';"""
count2 = text.count(old2)
text = text.replace(old2, new2)
print(f'2. replaced {count2} occurrences of isInternalPurchaseOnly')

with open(path, 'wb') as f:
    f.write(text.encode('utf-8'))
print('done')
print('userKind in text:', 'userKind' in text)
print('hasNonHanwhaSupplier in text:', 'hasNonHanwhaSupplier' in text)
print('isDispatchWaiting in text:', 'isDispatchWaiting' in text)
