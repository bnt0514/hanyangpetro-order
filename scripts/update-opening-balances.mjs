/**
 * 기초 미수금 일괄 업데이트 스크립트 (기준일: 2026-05-16)
 * 실행: node scripts/update-opening-balances.mjs
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const OPENING_DATE = new Date('2026-05-16T00:00:00.000Z');

// 거래처명 → 금액 매핑 (이미지 기준)
const balances = [
    // 자성식 담당
    { name: '주식회사사동방에프엔씨코리아', amount: 1567096987 },
    { name: '사동방에프엔씨코리아', amount: 1567096987 },
    { name: '(주)아모스안성', amount: 152840000 },
    { name: '아모스안성', amount: 152840000 },
    { name: '블레스정밀', amount: 25291475 },
    { name: '(주)모드켐', amount: 77758000 },
    { name: '모드켐', amount: 77758000 },
    { name: '홈코렝코퍼레이션주식회사', amount: 64500000 },
    { name: '홈코렝코퍼레이션', amount: 64500000 },
    { name: '태성에컴스주식회사', amount: 37268000 },
    { name: '태성에컴스', amount: 37268000 },
    { name: '주식회사자프', amount: 36994100 },
    { name: '자프', amount: 36994100 },
    { name: '부국티엔씨(주)', amount: 247379000 },
    { name: '부국티엔씨', amount: 247379000 },
    { name: '주식회사삼영인더스트리', amount: 103675000 },
    { name: '삼영인더스트리', amount: 103675000 },
    { name: '주식회사유진하이텍', amount: 18975000 },
    { name: '유진하이텍', amount: 18975000 },
    { name: '주식회사애니켐', amount: 82528950 },
    { name: '애니켐', amount: 82528950 },
    { name: '보스팩주식회사', amount: 722070000 },
    { name: '보스팩', amount: 722070000 },
    { name: '(주)주풍테크', amount: 53831075 },
    { name: '주풍테크', amount: 53831075 },
    { name: '(주)피이플렉스', amount: 2455000 },
    { name: '피이플렉스', amount: 2455000 },
    { name: '삼흥산업(주)', amount: 114268000 },
    { name: '삼흥산업㈜', amount: 114268000 },
    { name: '삼흥산업', amount: 114268000 },
    { name: '플라맥스주식회사', amount: 8844000 },
    { name: '플라맥스', amount: 8844000 },
    { name: '주식회사중원G.L.B', amount: 6820000 },
    { name: '중원G.L.B', amount: 6820000 },
    { name: '중원GLB', amount: 6820000 },
    { name: '(주)예그린제과', amount: 18056500 },
    { name: '예그린제과', amount: 18056500 },
    { name: '(주)에스메스씨', amount: 44550000 },
    { name: '에스메스씨', amount: 44550000 },
    { name: '주식회사케이포유', amount: 45210000 },
    { name: '케이포유', amount: 45210000 },
    { name: '주식회사한주시트', amount: 319000 },
    { name: '한주시트', amount: 319000 },
    { name: '제이피트리풀', amount: 143000 },
    { name: '나노켐텍주식회사', amount: 2530000 },
    { name: '나노켐텍', amount: 2530000 },
    { name: '제일화학공업(주)', amount: 2274000 },
    { name: '제일화학공업', amount: 2274000 },
    { name: '(주)영주', amount: 2140000 },
    { name: '영주', amount: 2140000 },
    { name: '주식회사다원유화', amount: 71736634 },
    { name: '다원유화', amount: 71736634 },
    { name: '신영케미칼주식회사', amount: 7340500 },
    { name: '신영케미칼', amount: 7340500 },
    { name: '익성화학', amount: 391556938 },
    { name: '신일폴리머', amount: -119854500 },
    { name: '주식회사썬켐폴리머', amount: 29700000 },
    { name: '썬켐폴리머', amount: 29700000 },
    { name: '주식회사비와이팩', amount: 67020000 },
    { name: '비와이팩', amount: 67020000 },
    { name: '주식회사성일기업', amount: 5940000 },
    { name: '성일기업', amount: 5940000 },
    { name: '(주)세일케미칼', amount: 874500 },
    { name: '세일케미칼', amount: 874500 },
    { name: '(주)아이큐포리머', amount: 1485000 },
    { name: '아이큐포리머', amount: 1485000 },
    // 김승철 담당
    { name: '성도화학', amount: 81213880 },
    { name: '(주)세경산업', amount: 29741250 },
    { name: '세경산업', amount: 29741250 },
    { name: '주식회사대일화학', amount: 500 },
    { name: '대일화학', amount: 500 },
    { name: '주식회사두두월드', amount: 12276000 },
    { name: '두두월드', amount: 12276000 },
    { name: '신성수지상사', amount: 25914900 },
    { name: '주영산업', amount: 76285002 },
    { name: '경기프라스틱', amount: 353800 },
    { name: '한일프라콘(주)안성공장', amount: 4943400 },
    { name: '한일프라콘안성공장', amount: 4943400 },
    { name: '한일프라콘', amount: 4943400 },
    { name: '주식회사스타폴리머', amount: 213565000 },
    { name: '스타폴리머', amount: 213565000 },
    { name: '에스메스케미칼', amount: 368500 },
    { name: '주식회사이에스지케미칼', amount: 95469550 },
    { name: '이에스지케미칼', amount: 95469550 },
    { name: '주식회사무진기업', amount: 45639000 },
    { name: '무진기업', amount: 45639000 },
    { name: '주식회사부경글로벌', amount: 13585000 },
    { name: '부경글로벌', amount: 13585000 },
    { name: '주식회사리딩테크', amount: 28710000 },
    { name: '리딩테크', amount: 28710000 },
    { name: '일성화학', amount: 34848000 },
    { name: '주식회사이루화학', amount: 5280000 },
    { name: '이루화학', amount: 5280000 },
    { name: '지구산업', amount: 28589000 },
    { name: '화성산업', amount: 14575000 },
    { name: '(주)그린제약', amount: 46288000 },
    { name: '그린제약', amount: 46288000 },
    { name: '주식회사서울하이텍', amount: 26262500 },
    { name: '서울하이텍', amount: 26262500 },
    // 김종철 담당
    { name: '에스디코리아주식회사', amount: 32120000 },
    { name: '에스디코리아', amount: 32120000 },
    { name: '마스텍주식회사', amount: 80718000 },
    { name: '마스텍', amount: 80718000 },
    { name: '세봉산업', amount: 32912000 },
    { name: '태림기업', amount: 75658000 },
    { name: '주식회사다인산업', amount: 113107500 },
    { name: '다인산업', amount: 113107500 },
    { name: '선원테크', amount: 22606000 },
    { name: '주식회사태원', amount: 5126000 },
    { name: '태원', amount: 5126000 },
    { name: '주식회사엠앤씨', amount: 171963000 },
    { name: '엠앤씨', amount: 171963000 },
    { name: '(주)에스앤에스테크', amount: 2510990 },
    { name: '에스앤에스테크', amount: 2510990 },
    { name: '(주)일진레이텍', amount: 60302000 },
    { name: '일진레이텍', amount: 60302000 },
    { name: '주식회사에스디인더스트리', amount: 41280000 },
    { name: '에스디인더스트리', amount: 41280000 },
    { name: '주식회사카이노스', amount: 103614500 },
    { name: '카이노스', amount: 103614500 },
    { name: '주식회사원폴리텍', amount: 115940000 },
    { name: '원폴리텍', amount: 115940000 },
    { name: '신성화인텍', amount: 104258000 },
    { name: '은진화학', amount: 7579000 },
    { name: '한국엔지니어링플라스틱(주)', amount: 32879000 },
    { name: '한국엔지니어링플라스틱', amount: 32879000 },
    { name: '(주)달리팩', amount: 18634000 },
    { name: '달리팩', amount: 18634000 },
    { name: 'REDRUN(레드런)', amount: 12320000 },
    { name: '레드런', amount: 12320000 },
    { name: 'REDRUN', amount: 12320000 },
    // 양희철 담당
    { name: '케이피한석유화주식회사', amount: 1951125 },
    { name: '케이피한석유화', amount: 1951125 },
    { name: '정진포리머', amount: 8153750 },
    { name: '(주)유웅인더스트리', amount: 9570000 },
    { name: '유웅인더스트리', amount: 9570000 },
    { name: '우일산업주식회사', amount: 1520200 },
    { name: '우일산업', amount: 1520200 },
    { name: '성도케미칼(주)', amount: 17072000 },
    { name: '성도케미칼', amount: 17072000 },
    { name: '(주)나봇케미칼', amount: 16500000 },
    { name: '나봇케미칼', amount: 16500000 },
    { name: '대월포리머', amount: -1000 },
    { name: '금성에이스산업(주)', amount: 126192000 },
    { name: '금성에이스산업', amount: 126192000 },
];

// 정규화 함수 (DB 거래처명과 매핑용)
function normalize(name) {
    return name
        .replace(/주식\s*회사/g, '')
        .replace(/\(주\)|㈜|\(유\)/g, '')
        .replace(/\s|\(|\)|\.|-/g, '')
        .toLowerCase()
        .trim();
}

async function main() {
    // 모든 거래처 조회
    const customers = await prisma.customer.findMany({
        select: { id: true, companyName: true, openingReceivable: true, openingReceivableDate: true },
    });

    console.log(`총 거래처: ${customers.length}명`);

    // 이미 처리한 고객 ID (중복 방지)
    const processedIds = new Set();

    let updated = 0;
    let notFound = [];
    const matchedNames = new Set();

    for (const { name, amount } of balances) {
        const normTarget = normalize(name);

        // 이미 매칭된 이름은 스킵 (별칭 중복 방지)
        if (matchedNames.has(normTarget)) continue;

        const match = customers.find(c => {
            const normDB = normalize(c.companyName);
            return normDB === normTarget || normDB.includes(normTarget) || normTarget.includes(normDB);
        });

        if (match && !processedIds.has(match.id)) {
            processedIds.add(match.id);
            matchedNames.add(normTarget);
            await prisma.customer.update({
                where: { id: match.id },
                data: {
                    openingReceivable: amount,
                    openingReceivableDate: OPENING_DATE,
                },
            });
            console.log(`✅ ${match.companyName} (${match.id}) → ${amount.toLocaleString()}원`);
            updated++;
        } else if (!match) {
            notFound.push(name);
        }
    }

    // 미매칭 항목 출력
    if (notFound.length > 0) {
        const unique = [...new Set(notFound)];
        console.log('\n⚠️  DB에서 찾지 못한 거래처:');
        unique.forEach(n => console.log(`  - ${n}`));
    }

    console.log(`\n완료: ${updated}개 거래처 업데이트`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
