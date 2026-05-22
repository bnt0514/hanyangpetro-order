export type HanwhaBagType = 'FFS' | 'FB500' | 'FB700' | 'FB750';

export const HANWHA_BAG_TYPES: HanwhaBagType[] = ['FFS', 'FB500', 'FB700', 'FB750'];

const MATERIALS_BY_STANDARD_NAME: Record<string, string[]> = {
    'LLDPE<3120MF>': ['MF_LLD_3120MF_FFS', 'MF_LLD_3120MF_FB700'],
    'LLDPE<3120>': ['MF_LLD_3120_FB700_LP1/LP2', 'MF_LLD_3120_FB750_LP1/LP2', 'MF_LLD_3120_FFS_LP1/LP2'],
    'LDPE<5316>': ['MF_LD_5316_FB700_LD1', 'MF_LD_5316_FB500_LD1', 'MF_LD_5316_FFS_LD1'],
    'LDPE<955>': ['MF_LD_955_FB500_LD2', 'MF_LD_955_FFS_LD2', 'MF_LD_955_FB750_LD2'],
    'LLDPE<3126>': ['MF_LLD_3126_FB750_LP1/LP2', 'MF_LLD_3126_FFS_LP1/LP2', 'MF_LLD_3126_FB700_LP1/LP2'],
    'LLDPE<3127D>': ['MF_LLD_3127D_FB500', 'MF_LLD_3127D_FB700', 'MF_LLD_3127D_FFS'],
    'LDPE<5318>': ['MF_LD_5318_FFS_LD2'],
    'LLDPE<3123>': ['MF_LLD_3123_FFS'],
    'LDPE<5321>': ['MF_LD_5321_FFS_LD1'],
    'LDPE<737>': ['MF_LD_737_FFS_LD', 'MF_LD_737_FFS_LDH'],
    'LDPE<5303>': ['MF_LD_5303_FFS_LD1'],
    'LDPE<963>': ['MF_LD_963_FB750_LD2', 'MF_LD_963_FFS_LD2'],
    'LDPE<5302>': ['MF_LD_5302_FFS_LD1'],
    'HDPE<7600>': ['MF_HD_7600_FFS_LP3'],
    'LLDPE<9730>': ['MF_LLD_9730_FFS_LP1'],
    'LDPE<303>': ['MF_LD_303_FFS_LD'],
    'LDPE<749>': ['MF_LD_749_FFS_LD1'],
    'LDPE<5325>': ['MF_LD_5325_FFS_LD2'],
    'LDPE<5310>': ['MF_LD_5310_FFS_LD2'],
    'LDPE<5321F>': ['MF_LD_5321F_FFS_LD2', 'MF_LD_5321F_FB750_LD2'],
    'HDPE<3392>': ['MF_HD_3392_FFS_LP3'],
    'LDPE<5306>': ['MF_LD_5306_FFS_LD1', 'MF_LD_5306_FB700_LD1'],
    'LDPE<5602S>': ['MF_LD_5602S_FB700_LD1', 'MF_LD_5602S_FFS_LD1'],
    'LLDPE<7635>': ['MF_LLD_7635_FFS_LP1/LP2'],
    'LLDPE<3224>': ['MF_LLD_3224_FFS_LP1/LP2'],
    'LLDPE<4200D>': ['MF_LLD_4200D_FB700', 'MF_LLD_4200D_FFS'],
    'EVA<2040>': ['MF_EVA_2040_FB500_LD1', 'MF_EVA_2040_FFS_LD1'],
    'mLLDPE<M1810HA>': ['MF_LLD_M1810HA_FFS_LP1/LP 2', 'MF_LLD_M1810HA_FB700'],
    'mLLDPE<M3505EN>': ['MF_LLD_M3505EN_FFS_LP1/LP 2'],
    'mLLDPE<M1605EN>': ['MF_LLD_M1605EN_FB700_LP2', 'MF_LLD_M1605EN_FFS'],
    'LLDPE<V1408DN>': ['MF_LLD_V1408DN_FB500_LP2', 'MF_LLD_V1408DN_FFS_LP1/LP 2'],
    'EVA<2315>': ['MF_EVA_2315_FFS_LD1'],
    'mLLDPE<M1835HN>': ['MF_LLD_M1835HN_FFS_LP1/LP 2', 'MF_LLD_M1835HN_FB700'],
    'mLLDPE<M2703EN>': ['MF_LLD_M2703EN_FFS_LP1/LP 2'],
    'EVA<1828>': ['MF_EVA_1828_FFS_LD'],
    'EVA<1157>': ['MF_EVA_1157_FFS_LD'],
    'HDPE<8380>': ['MF_HD_8380_FFS_LP2'],
    'mLLDPE<M1810HC>': ['MF_LLD_M1810HC_FFS_LP1/LP 2', 'MF_LLD_M1810HC_FB700_LP1/LP 2'],
    'LDPE<5301>': ['MF_LD_5301_FFS_LD1'],
    'LDPE<5321A>': ['MF_LD_5321A_FB500_LD1', 'MF_LD_5321A_FFS_LD1'],
};

function normalizeStandardName(value: string | null | undefined) {
    return (value ?? '').replace(/\s+/g, '').toUpperCase();
}

function normalizeMaterial(value: string) {
    return value.replace(/\s+/g, '').toUpperCase();
}

function getBagToken(value?: string | null): HanwhaBagType {
    const normalized = (value ?? '').trim().toUpperCase();
    return HANWHA_BAG_TYPES.includes(normalized as HanwhaBagType) ? normalized as HanwhaBagType : 'FFS';
}

function materialBagRank(material: string, bagType: HanwhaBagType) {
    const normalized = normalizeMaterial(material);
    if (normalized.includes(`_${bagType}_`) || normalized.endsWith(`_${bagType}`)) return 0;
    if (bagType === 'FFS' && normalized.includes('_FFS')) return 0;
    return 1;
}

function productFamilyPrefix(productName: string) {
    if (/HDPE/i.test(productName)) return 'HD';
    if (/EVA/i.test(productName)) return 'EVA';
    if (/m?LLDPE/i.test(productName)) return 'LLD';
    if (/LDPE/i.test(productName)) return 'LD';
    return null;
}

function productGrade(productName: string) {
    return productName.match(/<\s*([^>]+)\s*>/)?.[1]?.replace(/\s+/g, '')
        ?? productName.match(/\b[A-Z]?\d{3,5}[A-Z]*\b/i)?.[0]
        ?? null;
}

function fallbackMaterialName(productName: string, bagType: HanwhaBagType) {
    const prefix = productFamilyPrefix(productName);
    const grade = productGrade(productName);
    if (!prefix || !grade) {
        throw new Error(`${productName}의 한화 자재명을 찾을 수 없습니다. 제품의 한화 자재명을 등록해 주세요.`);
    }
    return `MF_${prefix}_${grade}_${bagType}`;
}

export function findMappedHanwhaMaterials(productName: string) {
    const target = normalizeStandardName(productName);
    return Object.entries(MATERIALS_BY_STANDARD_NAME).find(([standardName]) => normalizeStandardName(standardName) === target)?.[1] ?? [];
}

export function resolveHanwhaMaterialName(input: {
    productName: string;
    productCode?: string | null;
    explicitMaterialName?: string | null;
    bagType?: string | null;
}) {
    const bagType = getBagToken(input.bagType);
    const mapped = findMappedHanwhaMaterials(input.productName);
    if (mapped.length > 0) {
        const exactBagMaterial = mapped.find((material) => materialBagRank(material, bagType) === 0);
        return exactBagMaterial ?? fallbackMaterialName(input.productName, bagType);
    }

    const explicit = input.explicitMaterialName?.trim();
    if (explicit) return stripLineSuffixWithBag(explicit, bagType);

    const code = input.productCode?.trim();
    if (code && /^MF_/i.test(code)) return stripLineSuffixWithBag(code, bagType);

    return fallbackMaterialName(input.productName, bagType);
}

export function stripLineSuffixWithBag(materialName: string, bagType: HanwhaBagType = 'FFS') {
    const normalized = materialName.trim();
    const match = normalized.match(new RegExp(`^(.*?_${bagType})(?:_.+)?$`, 'i'));
    if (match) return match[1];

    const anyBagMatch = normalized.match(/^(.*?_(?:FFS|FB500|FB700|FB750))(?:_.+)?$/i);
    if (!anyBagMatch) return normalized;
    return anyBagMatch[1].replace(/_(FFS|FB500|FB700|FB750)$/i, `_${bagType}`);
}
