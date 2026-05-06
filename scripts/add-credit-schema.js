/**
 * Add CreditTransaction and CreditOverrideRequest models to prisma/schema.prisma
 */
const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const raw = fs.readFileSync(schemaPath, 'utf8');

if (raw.includes('CreditTransaction')) {
    console.log('Already patched — skipping');
    process.exit(0);
}

let lines = raw.replace(/\r\n/g, '\n').split('\n');

const idxUserBackup = lines.findIndex(l => l.includes('backedUpBy') && l.includes('@relation("UserBackup")'));
const idxCustomerOrders = lines.findIndex(l => /^\s+orders\s+Order\[\]\s*$/.test(l));
const idxOrderNotifications = lines.findIndex(l => /^\s+notifications\s+NotificationLog\[\]\s*$/.test(l));

console.log('Found at:', { idxUserBackup: idxUserBackup + 1, idxCustomerOrders: idxCustomerOrders + 1, idxOrderNotifications: idxOrderNotifications + 1 });

if (idxUserBackup < 0 || idxCustomerOrders < 0 || idxOrderNotifications < 0) {
    // Fallback: print context to debug
    lines.forEach((l, i) => {
        if (l.includes('backedUpBy') || l.includes('orders') || l.includes('notifications')) {
            console.log(i + 1, JSON.stringify(l));
        }
    });
    process.exit(1);
}

// Insert in REVERSE order so earlier indices stay valid
// 3) After notifications in Order model
lines.splice(idxOrderNotifications + 1, 0,
    '  creditTransaction  CreditTransaction?',
    '  creditOverride     CreditOverrideRequest?'
);

// 2) After orders in Customer model
lines.splice(idxCustomerOrders + 1, 0,
    '  creditTransactions CreditTransaction[]'
);

// 1) After backedUpBy in User model  
lines.splice(idxUserBackup + 1, 0,
    '  creditTransactions    CreditTransaction[]    @relation("CreditTxCreatedBy")',
    '  overrideRequested     CreditOverrideRequest[] @relation("OverrideRequested")',
    '  overrideReviewed      CreditOverrideRequest[] @relation("OverrideReviewed")'
);

// Append new models at end
const append = [
    '',
    '// =====================================================================',
    '// Credit (여신) 시스템',
    '// =====================================================================',
    '',
    '/// OUT: 출고 확정 자동 | IN: 입금 | ADJ: 수동 조정 (양희철 전용)',
    'model CreditTransaction {',
    '  id          String   @id @default(cuid())',
    '  customerId  String',
    '  customer    Customer @relation(fields: [customerId], references: [id])',
    '  txDate      DateTime',
    '  txType      String   // OUT | IN | ADJ',
    '  amount      Float',
    '  source      String   @default("MANUAL") // ORDER | UPLOAD | MANUAL',
    '  orderId     String?',
    '  order       Order?   @relation(fields: [orderId], references: [id])',
    '  memo        String?',
    '  createdById String?',
    '  createdBy   User?    @relation("CreditTxCreatedBy", fields: [createdById], references: [id])',
    '  createdAt   DateTime @default(now())',
    '',
    '  @@index([customerId])',
    '  @@index([txDate])',
    '  @@index([txType])',
    '  @@index([orderId])',
    '}',
    '',
    '/// 여신 한도초과 주문 승인 요청 — 양희철(EXECUTIVE)만 승인',
    'model CreditOverrideRequest {',
    '  id                String   @id @default(cuid())',
    '  orderId           String   @unique',
    '  order             Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)',
    '  currentReceivable Float',
    '  creditLimit       Float',
    '  overAmount        Float',
    '  status            String   @default("PENDING") // PENDING | APPROVED | REJECTED',
    '  requestedById     String?',
    '  requestedBy       User?    @relation("OverrideRequested", fields: [requestedById], references: [id])',
    '  reviewedById      String?',
    '  reviewedBy        User?    @relation("OverrideReviewed", fields: [reviewedById], references: [id])',
    '  reviewedAt        DateTime?',
    '  rejectReason      String?',
    '  createdAt         DateTime @default(now())',
    '  updatedAt         DateTime @updatedAt',
    '',
    '  @@index([status])',
    '  @@index([createdAt])',
    '}',
    '',
];

lines = lines.concat(append);

fs.writeFileSync(schemaPath, lines.join('\n'), { encoding: 'utf8' });
console.log('Done. Total lines:', lines.length);
