/**
 * credit-limits-proposed.json 기반으로 Customer.creditLimit 일괄 업데이트
 * customerCode로 매칭, 없으면 스킵 (로그 출력)
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  const proposed = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'data', 'credit-limits-proposed.json'), 'utf8')
  );

  let updated = 0, skipped = 0;

  for (const item of proposed) {
    // customerCode 또는 이름으로 매칭
    let customer = await prisma.customer.findFirst({
      where: { customerCode: item.customerCode },
      select: { id: true, companyName: true, creditLimit: true },
    });

    if (!customer) {
      // 코드 없으면 이름으로 시도
      customer = await prisma.customer.findFirst({
        where: { companyName: item.customerName },
        select: { id: true, companyName: true, creditLimit: true },
      });
    }

    if (!customer) {
      console.log(`⚠️  미매칭: ${item.customerName} (${item.customerCode})`);
      skipped++;
      continue;
    }

    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        creditLimit: item.proposedCreditLimit,
      },
    });
    console.log(`✅ ${customer.companyName}: ${customer.creditLimit.toLocaleString('ko-KR')} → ${item.proposedCreditLimit.toLocaleString('ko-KR')}원`);
    updated++;
  }

  console.log(`\n완료: ${updated}개 업데이트, ${skipped}개 미매칭`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
