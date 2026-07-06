import { productIdentityKey } from '@/lib/product-identity';

const LDPE_737_REPORT_KEY = 'name:LDPE737';
const LDPE_737_REPORT_LABEL = 'LDPE<737>';
const LDPE_737_NAMES = new Set(['LDPE737', 'LDPE737LDH']);

function compactAscii(value: string | null | undefined) {
    return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function reportProductGroupKey(productName: string | null | undefined, fallbackKey: string) {
    return LDPE_737_NAMES.has(compactAscii(productName)) ? LDPE_737_REPORT_KEY : fallbackKey;
}

export function reportProductGroupLabel(productName: string | null | undefined, fallbackLabel = 'Unknown product') {
    const label = productName?.trim() || fallbackLabel;
    return LDPE_737_NAMES.has(compactAscii(label)) ? LDPE_737_REPORT_LABEL : label;
}

export function reportProductIdentityKey(productName: string | null | undefined, productCode?: string | null) {
    return reportProductGroupKey(productName, productIdentityKey(productName, productCode));
}

export function reportProductLookupKeys(
    product: { id?: string | null; productName?: string | null; productCode?: string | null } | null | undefined,
    fallbackName?: string | null,
) {
    const productName = product?.productName || fallbackName || '';
    const baseKeys = [
        product?.id ? `id:${product.id}` : null,
        productIdentityKey(productName, product?.productCode),
    ].filter((key): key is string => Boolean(key));
    const reportKey = reportProductGroupKey(productName, baseKeys[0] ?? productIdentityKey(productName, product?.productCode));
    return Array.from(new Set([...baseKeys, reportKey]));
}

export function reportProductMatchesQuery(productName: string | null | undefined, query: string | null | undefined) {
    const rawQuery = (query ?? '').trim().toLowerCase();
    if (!rawQuery) return true;
    const q = compactAscii(rawQuery);
    const rawProduct = (productName ?? '').toLowerCase();
    if (!q) return rawProduct.includes(rawQuery);
    const product = compactAscii(productName);
    if (q === '737' || q === 'LDPE737') return product.includes('737');
    return product.includes(q) || rawProduct.includes(rawQuery);
}
