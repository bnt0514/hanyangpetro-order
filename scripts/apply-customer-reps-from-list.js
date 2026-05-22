const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const RAW = `
차성식	주식회사동방에프엔씨코리아
차성식	(주)아모스 안성
차성식	블루시스템
차성식	(주)모드켐
차성식	월드캠코퍼레이션 주식회사
차성식	태성에컴스주식회사
차성식	주식회사 자르
차성식	부국티엔씨(주)
차성식	주식회사 삼영민더스트리
차성식	주식회사 뮤진하이텍
차성식	주식회사 에니켐
차성식	보스팩 주식회사
차성식	(주)주풍테크
차성식	(주)파이플렉스
차성식	삼흥산업(주)
차성식	폴라맥스 주식회사
차성식	주식회사 준원G,L,B
차성식	(주)에그린제과
차성식	(주)에스에스씨
차성식	주식회사 케이포우
차성식	주식회사 한주시트
차성식	제이미트리플
김승철	성도화학
김승철	(주)제광산업
김승철	주식회사 대일화학
김승철	주식회사 두루월드
김승철	신성수지상사
김승철	주영산업사
김승철	경기프라스틱
김승철	한일프라콘(주)안성공장
김승철	반석기업
김승철	주식회사 스타폴리머
김승철	에스에스케미칼
김승철	주식회사 에어스카케미칼
김승철	주식회사 온지기업
김승철	주식회사 부경글로벌
김승철	주식회사 리딩테크
김승철	일성화학
김승철	주식회사 이루화학
김승철	지구산업
김승철	화성산업
김승철	대신기업
김승철	에스디코리아 주식회사
김종철	마스텍 주식회사
김종철	세봉산업
김종철	태림기업
김종철	주식회사 다인산업
김종철	선원테크
김종철	주식회사 태원
김종철	주식회사 에이씨
김종철	(주)에스앤에스테크
김종철	주식회사 태일기업
김종철	(주)일진레미텍
김종철	주식회사 에스디민더스트리
김종철	주식회사 카이트스
김종철	주식회사 원폴리텍
김종철	신성화인텍
김종철	은진화학
김종철	한국엔지니어링플라스틱(주)
김종철	(주)달리팩
김종철	주식회사 태승화학
김종철	REDRUN(레드런)
차성식	나노캠텍 주식회사
차성식	제일화학공업(주)
차성식	(주)영주
차성식	주식회사 다원유화
차성식	신영케미칼 주식회사
차성식	의성화학
차성식	신일폴리머
차성식	주식회사 성경폴리머
양희철	케이피한석유화 주식회사
차성식	정진프리아
차성식	(주)우영민더스트리
양희철	신현수지
김승철	(주)그린제약
김승철	주식회사 서울하이텍
양희철	우일산업 주식회사
김승철	탑전기
양희철	성도케미칼(주)
양희철	(주)나봇케미칼
양희철	대광포리머
양희철	금성에이스산업(주)
차성식	주식회사 비아이팩
차성식	주식회사 선일기업
차성식	(주)세일케미칼
차성식	(주)아이큐포리머
`;

function normalizeCompanyName(name) {
    return String(name || '')
        .replace(/주식회사\s*/g, '')
        .replace(/\(주\)/g, '')
        .replace(/㈜/g, '')
        .replace(/\(유\)/g, '')
        .replace(/유한회사\s*/g, '')
        .replace(/합자회사\s*/g, '')
        .replace(/\s+/g, '')
        .toLowerCase()
        .trim();
}

function normalizePersonName(name) {
    return String(name || '').replace(/\s+/g, '').trim();
}

function matchByName(list, key, rawName) {
    const norm = normalizeCompanyName(rawName);
    let found = list.find((x) => normalizeCompanyName(x[key]) === norm);
    if (!found) {
        found = list.find((x) => {
            const candidate = normalizeCompanyName(x[key]);
            return candidate && (candidate.includes(norm) || norm.includes(candidate));
        });
    }
    return found || null;
}

async function main() {
    const mappings = RAW.trim().split(/\r?\n/).map((line) => {
        const [repName, customerName] = line.split(/\t+/).map((v) => v.trim());
        return { repName, customerName };
    }).filter((row) => row.repName && row.customerName);

    const [users, customers] = await Promise.all([
        prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
        prisma.customer.findMany({ select: { id: true, companyName: true, defaultSalesRepId: true } }),
    ]);

    let matched = 0;
    let saved = 0;
    const unmatchedCustomers = [];
    const unmatchedReps = [];

    for (const item of mappings) {
        const rep = users.find((u) => normalizePersonName(u.name) === normalizePersonName(item.repName));
        if (!rep) {
            unmatchedReps.push(item);
            continue;
        }
        const customer = matchByName(customers, 'companyName', item.customerName);
        if (!customer) {
            unmatchedCustomers.push(item);
            continue;
        }
        matched++;
        console.log(`✓ ${customer.companyName} ← ${rep.name}`);
        if (APPLY && customer.defaultSalesRepId !== rep.id) {
            await prisma.customer.update({ where: { id: customer.id }, data: { defaultSalesRepId: rep.id } });
            saved++;
        }
    }

    console.log(JSON.stringify({ total: mappings.length, matched, saved, unmatchedCustomers: unmatchedCustomers.length, unmatchedReps: unmatchedReps.length }, null, 2));
    if (unmatchedCustomers.length) {
        console.log('\n[미매칭 거래처]');
        unmatchedCustomers.forEach((x) => console.log(`${x.repName}\t${x.customerName}`));
    }
    if (unmatchedReps.length) {
        console.log('\n[미매칭 담당자]');
        unmatchedReps.forEach((x) => console.log(`${x.repName}\t${x.customerName}`));
    }
    if (!APPLY) console.log('\n[DRY RUN] 실제 저장하려면 --apply');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
