const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
    const tables = await p.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    console.log(tables);
    await p.$disconnect();
})();
