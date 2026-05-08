// 단가 관련 상수 (use server 파일에 넣을 수 없음)
export const BRANDS = ['한화', '롯데', 'LG', '대한유화', '기타'] as const;
export const PRODUCT_GROUPS = ['LDPE', 'LLDPE', 'EVA', 'HDPE', 'mLLDPE', '기타'] as const;
export type Brand = (typeof BRANDS)[number];
export type ProductGroup = (typeof PRODUCT_GROUPS)[number];
