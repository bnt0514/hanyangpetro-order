import { resolveHanwhaMaterialName } from '../src/lib/hanwha-material-map';

const cases = [
    { productName: 'LDPE<955>', bagType: undefined, expected: 'MF_LD_955_FFS_LD2' },
    { productName: 'LDPE<955>', bagType: 'FB750', expected: 'MF_LD_955_FB750_LD2' },
    { productName: 'LDPE<955>', bagType: 'FB700', expected: 'MF_LD_955_FB700' },
    { productName: 'EVA<1533>', bagType: undefined, expected: 'MF_EVA_1533_FFS' },
    { productName: 'HDPE<8380L>', bagType: undefined, expected: 'MF_HD_8380L_FFS' },
    { productName: 'LDPE<5316>', bagType: undefined, expected: 'MF_LD_5316_FFS_LD1' },
    { productName: 'LDPE<5316>', bagType: 'FB750', expected: 'MF_LD_5316_FB750' },
];

let failed = 0;
for (const testCase of cases) {
    const actual = resolveHanwhaMaterialName(testCase);
    const ok = actual === testCase.expected;
    console.log(`${ok ? 'OK' : 'FAIL'} ${testCase.productName} ${testCase.bagType ?? 'default'} -> ${actual}`);
    if (!ok) {
        console.log(`  expected: ${testCase.expected}`);
        failed += 1;
    }
}

if (failed > 0) process.exit(1);
