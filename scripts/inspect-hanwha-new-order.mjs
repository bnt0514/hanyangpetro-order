import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    const text = fs.readFileSync(filePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const index = trimmed.indexOf('=');
        if (index === -1) continue;
        const key = trimmed.slice(0, index).trim();
        let value = trimmed.slice(index + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = value;
    }
}

const rootDir = process.cwd();
loadEnvFile(path.join(rootDir, '.env'));

const username = process.env.HANWHA_USERNAME;
const password = process.env.HANWHA_PASSWORD;
const loginUrl = process.env.HANWHA_LOGIN_URL ?? 'https://h-crm.my.site.com/order';
const outDir = path.join(rootDir, 'tmp', 'hanwha-inspect');
fs.mkdirSync(outDir, { recursive: true });

if (!username || !password) {
    console.error('HANWHA_USERNAME/HANWHA_PASSWORD is missing.');
    process.exit(1);
}

const NEW_ORDER_SELECTOR = "a[href='/order/s/customerneworder']";

async function clickNewOrder(page) {
    for (let attempt = 1; attempt <= 12; attempt++) {
        const link = page.locator(NEW_ORDER_SELECTOR).first();
        if (await link.isVisible().catch(() => false)) {
            await link.click();
            await page.waitForTimeout(3000);
            return;
        }
        const button = page.locator('button, a').filter({ hasText: /새\s*주문|신규\s*주문|New\s*Order/i }).first();
        if (await button.isVisible().catch(() => false)) {
            await button.click();
            await page.waitForTimeout(3000);
            return;
        }
        await page.waitForTimeout(1000);
    }
    throw new Error('새 주문 메뉴를 찾지 못했습니다.');
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();

try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.fill('#username', username);
    await page.fill('#password', password);
    await page.click('#Login');

    await Promise.race([
        page.locator('button.comm-navigation__top-level-item-link').first().waitFor({ timeout: 45000 }),
        page.locator(NEW_ORDER_SELECTOR).first().waitFor({ timeout: 45000 }),
    ]);

    await clickNewOrder(page);
    await page.waitForTimeout(5000);

    const snapshot = await page.evaluate(() => {
        function textOf(el) {
            return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        }
        function labelFor(el) {
            const id = el.getAttribute('id');
            const aria = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || '';
            const labelByFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
            const parentLabel = el.closest('label');
            const lightning = el.closest('lightning-input, lightning-combobox, lightning-textarea, lightning-datepicker, lightning-base-combobox');
            return [
                aria,
                labelByFor ? textOf(labelByFor) : '',
                parentLabel ? textOf(parentLabel) : '',
                lightning ? textOf(lightning) : '',
            ].filter(Boolean).join(' | ');
        }
        const fields = [...document.querySelectorAll('input, textarea, select, button[role="combobox"], [role="combobox"], lightning-combobox, lightning-input, lightning-textarea')].map((el, index) => ({
            index,
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('type'),
            name: el.getAttribute('name'),
            id: el.getAttribute('id'),
            role: el.getAttribute('role'),
            label: labelFor(el),
            value: el.value ?? el.getAttribute('value') ?? '',
            visibleText: textOf(el).slice(0, 160),
            disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
            required: el.required || el.getAttribute('aria-required') === 'true',
        }));
        const buttons = [...document.querySelectorAll('button, a')].map((el, index) => ({
            index,
            tag: el.tagName.toLowerCase(),
            text: textOf(el).slice(0, 160),
            title: el.getAttribute('title'),
            name: el.getAttribute('name'),
            href: el.getAttribute('href'),
            disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
        })).filter((b) => b.text || b.title || b.name || b.href);
        const dialogs = [...document.querySelectorAll('.slds-modal, section[role="dialog"], div[role="dialog"]')].map((el, index) => ({
            index,
            text: textOf(el).slice(0, 2000),
        }));
        return { url: location.href, title: document.title, fields, buttons, dialogs };
    });

    fs.writeFileSync(path.join(outDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, 'page.html'), await page.content(), 'utf8');
    await page.screenshot({ path: path.join(outDir, 'screenshot.png'), fullPage: true });

    const addProductButton = page.locator('button').filter({ hasText: '제품 추가' }).last();
    if (await addProductButton.isVisible().catch(() => false)) {
        await addProductButton.click();
        await page.waitForTimeout(3000);
        const productSnapshot = await page.evaluate(() => {
            function textOf(el) {
                return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            }
            function labelFor(el) {
                const id = el.getAttribute('id');
                const aria = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || '';
                const labelByFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
                const parentLabel = el.closest('label');
                const lightning = el.closest('lightning-input, lightning-combobox, lightning-textarea, lightning-datepicker, lightning-base-combobox');
                return [aria, labelByFor ? textOf(labelByFor) : '', parentLabel ? textOf(parentLabel) : '', lightning ? textOf(lightning) : ''].filter(Boolean).join(' | ');
            }
            const fields = [...document.querySelectorAll('input, textarea, select, button[role="combobox"], [role="combobox"], lightning-combobox, lightning-input, lightning-textarea')].map((el, index) => ({
                index,
                tag: el.tagName.toLowerCase(),
                type: el.getAttribute('type'),
                name: el.getAttribute('name'),
                id: el.getAttribute('id'),
                role: el.getAttribute('role'),
                label: labelFor(el),
                value: el.value ?? el.getAttribute('value') ?? '',
                visibleText: textOf(el).slice(0, 160),
                disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
                required: el.required || el.getAttribute('aria-required') === 'true',
            }));
            const buttons = [...document.querySelectorAll('button, a')].map((el, index) => ({
                index,
                tag: el.tagName.toLowerCase(),
                text: textOf(el).slice(0, 160),
                title: el.getAttribute('title'),
                name: el.getAttribute('name'),
                href: el.getAttribute('href'),
                disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
            })).filter((b) => b.text || b.title || b.name || b.href);
            const dialogs = [...document.querySelectorAll('.slds-modal, section[role="dialog"], div[role="dialog"]')].map((el, index) => ({
                index,
                text: textOf(el).slice(0, 2000),
            }));
            return { url: location.href, title: document.title, fields, buttons, dialogs };
        });
        fs.writeFileSync(path.join(outDir, 'product-snapshot.json'), JSON.stringify(productSnapshot, null, 2), 'utf8');
        fs.writeFileSync(path.join(outDir, 'product-page.html'), await page.content(), 'utf8');
        await page.screenshot({ path: path.join(outDir, 'product-screenshot.png'), fullPage: true });
        console.log(`Product popup: fields=${productSnapshot.fields.length}, buttons=${productSnapshot.buttons.length}, dialogs=${productSnapshot.dialogs.length}`);
    }

    console.log(`URL: ${snapshot.url}`);
    console.log(`fields=${snapshot.fields.length}, buttons=${snapshot.buttons.length}, dialogs=${snapshot.dialogs.length}`);
    console.log(`Saved: ${outDir}`);
    console.log('First 40 fields:');
    for (const field of snapshot.fields.slice(0, 40)) {
        console.log(`${field.index}. ${field.tag} name=${field.name ?? ''} type=${field.type ?? ''} label=${field.label}`);
    }
} finally {
    await browser.close();
}