import { prisma } from '../src/lib/db';
import { getHanwhaPassword, getHanwhaUsername } from '../src/lib/hanwha-credentials';
import { openHanwhaESalesLogin } from '../src/lib/hanwha-esales-login';

async function main() {
    const [username, password] = await Promise.all([
        getHanwhaUsername(),
        getHanwhaPassword(),
    ]);

    if (!username || !password) {
        throw new Error('Hanwha e-Sales credentials are not configured.');
    }

    if (process.argv.includes('--dry-run')) {
        console.log('Hanwha e-Sales reboot login is ready.');
        return;
    }

    const result = await openHanwhaESalesLogin({
        username,
        password,
        forceLogin: process.env.HANWHA_ESALES_FORCE_LOGIN === '1',
    });
    if (!result.ok) throw new Error(result.error);

    console.log(result.message);
}

void main()
    .then(() => {
        process.exitCode = 0;
    })
    .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect().catch(() => undefined);
        // The CDP connection remains open by design. End only this helper,
        // never the Chrome process or its e-Sales tab.
        process.exit(process.exitCode ?? 0);
    });
