export type ProductMatchInput = {
    productName?: string | null;
    productCode?: string | null;
};

export type MaterialMatchInput = {
    materialName?: string | null;
    materialNameRaw?: string | null;
};

export type ProductMaterialMatch = {
    matches: boolean;
    score: number;
    reason: string;
    sharedTokens: string[];
};

const GROUP_ALIASES: Record<string, string> = {
    LD: 'LDPE',
    LLD: 'LLDPE',
    MLLD: 'MLLDPE',
    MLLDPE: 'MLLDPE',
    HD: 'HDPE',
};

const PRODUCT_GROUPS = ['MLLDPE', 'LLDPE', 'LDPE', 'HDPE', 'EVA', 'PP', 'PS', 'ABS'] as const;

export function normalizeProductTokenText(value?: string | null): string {
    return (value ?? '')
        .toUpperCase()
        .replace(/^MF[_\s-]*/g, '')
        .replace(/[<>{}\[\]().,/\\_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function extractProductTokens(...values: Array<string | null | undefined>): string[] {
    const normalized = values.map(normalizeProductTokenText).join(' ');
    const tokens = normalized.match(/[A-Z]+\d+[A-Z0-9]*|\d+[A-Z0-9]*|[A-Z]{2,}/g) ?? [];
    return Array.from(new Set(tokens.map((token) => GROUP_ALIASES[token] ?? token)));
}

export function extractProductGroup(...values: Array<string | null | undefined>): string | null {
    const tokens = extractProductTokens(...values);
    return PRODUCT_GROUPS.find((group) => tokens.includes(group)) ?? null;
}

export function extractGradeTokens(...values: Array<string | null | undefined>): string[] {
    return extractProductTokens(...values).filter((token) => /\d/.test(token));
}

export function matchProductToMaterial(
    product: ProductMatchInput,
    material: MaterialMatchInput,
): ProductMaterialMatch {
    const materialTokens = extractProductTokens(material.materialName, material.materialNameRaw);
    const productTokens = extractProductTokens(product.productName, product.productCode);
    const materialGroup = extractProductGroup(material.materialName, material.materialNameRaw);
    const productGroup = extractProductGroup(product.productName, product.productCode);
    const materialGrades = extractGradeTokens(material.materialName, material.materialNameRaw);
    const productGrades = extractGradeTokens(product.productName, product.productCode);
    const sharedTokens = materialTokens.filter((token) => productTokens.includes(token));
    const sharedGrades = materialGrades.filter((token) => productGrades.includes(token));

    let score = 0;
    if (materialGroup && productGroup && materialGroup === productGroup) score += 25;
    if (sharedGrades.length > 0) score += 70;
    if (sharedTokens.length > 0) score += Math.min(20, sharedTokens.length * 5);

    const matches = sharedGrades.length > 0 || (Boolean(materialGroup) && materialGroup === productGroup && sharedTokens.length > 0);
    const reason = sharedGrades.length > 0
        ? `품번 ${sharedGrades.join(', ')} 일치`
        : materialGroup && productGroup && materialGroup === productGroup
            ? `${materialGroup} 계열 일치`
            : '품목 불일치';

    return { matches, score, reason, sharedTokens };
}

export function isSameQuantity(a: number | null | undefined, b: number | null | undefined): boolean {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return Math.abs(Number(a) - Number(b)) < 0.0001;
}