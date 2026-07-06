export const BRANDS = ['한화', '롯데', 'LG', '대한유화', '기타'] as const;
export const PRODUCT_GROUPS = ['LDPE', 'LLDPE', 'EVA', 'HDPE', 'mLLDPE', 'PP'] as const;
export type Brand = (typeof BRANDS)[number];
export type ProductGroup = (typeof PRODUCT_GROUPS)[number];
