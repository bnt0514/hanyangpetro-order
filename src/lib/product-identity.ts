export function normalizeProductIdentity(value: string | null | undefined) {
    return (value ?? '')
        .replace(/^\s*(ITEM|IMP)[-_\s]+/i, '')
        .replace(/P\.P/gi, 'PP')
        .replace(/[<>()（）]/g, '')
        .replace(/[^a-zA-Z0-9가-힣]+/g, '')
        .trim()
        .toUpperCase();
}

export function productIdentityKey(productName: string | null | undefined, productCode?: string | null) {
    const nameKey = normalizeProductIdentity(productName);
    if (nameKey) return `name:${nameKey}`;
    const codeKey = normalizeProductIdentity(productCode);
    return codeKey ? `code:${codeKey}` : 'unknown';
}

export function canonicalProductCode(productName: string, productCode: string | null | undefined) {
    if (productCode && !/^ITEM-|^IMP-/i.test(productCode)) return productCode;
    return normalizeProductIdentity(productName) || productName;
}