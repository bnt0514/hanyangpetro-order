import { chromium, type Browser, type Page } from 'playwright';

export type HanwhaNewOrderResult =
    | { ok: true; message: string }
    | { ok: false; error: string; errorCode?: 'NO_CREDENTIALS' | 'AUTH_FAILED' | 'AUTOMATION_FAILED' };

type HanwhaNewOrderOptions = {
    username?: string | null;
    password?: string | null;
    deliveryAddressName?: string | null;
};

const globalForHanwhaOrder = globalThis as typeof globalThis & {
    __hanwhaOrderBrowsers?: Browser[];
};

const HANWHA_NEW_ORDER_SELECTOR = "a[href='/order/s/customerneworder']";
const HANWHA_DIALOG_SELECTOR = '.slds-modal, section[role="dialog"], div[role="dialog"]';
const HANWHA_VISIBLE_DIALOG_SELECTOR = '.slds-modal:visible, section[role="dialog"]:visible, div[role="dialog"]:visible';
const HANWHA_SHIP_TO_SEARCH_SELECTOR = 'button[name="ord_ShipTo__c"]';

function visibleHanwhaDialog(page: Page) {
    return page.locator(HANWHA_VISIBLE_DIALOG_SELECTOR).last();
}

async function isHanwhaDialogVisible(page: Page) {
    return await page.locator(HANWHA_VISIBLE_DIALOG_SELECTOR).first().isVisible().catch(() => false);
}

async function waitForHanwhaDialog(page: Page, timeout = 30_000) {
    await page.locator(HANWHA_VISIBLE_DIALOG_SELECTOR).first().waitFor({ state: 'visible', timeout });
    return visibleHanwhaDialog(page);
}

async function pressEnterUntilDialog(page: Page) {
    for (let attempt = 1; attempt <= 10; attempt++) {
        if (await isHanwhaDialogVisible(page)) return;
        await page.keyboard.press('Enter');
        if (await isHanwhaDialogVisible(page)) return;
        await page.waitForTimeout(1_000);
    }

    await waitForHanwhaDialog(page, 5_000);
}

async function chooseFirstPopupRow(page: Page) {
    const dialog = await waitForHanwhaDialog(page);
    const checkbox = dialog.locator('label.slds-checkbox__label, span.slds-checkbox_faux, input[type="checkbox"]').first();
    await checkbox.waitFor({ state: 'visible', timeout: 30_000 });
    await checkbox.click();

    const selectButton = dialog.locator('button').filter({ hasText: /^선택$/ }).last();
    await selectButton.waitFor({ state: 'visible', timeout: 30_000 });
    await selectButton.click();
    await page.locator(HANWHA_DIALOG_SELECTOR).first().waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
}

async function fillShipToName(page: Page, deliveryAddressName?: string | null) {
    const shipToName = deliveryAddressName?.trim();
    if (!shipToName) return;

    const searchButton = page.locator(HANWHA_SHIP_TO_SEARCH_SELECTOR).first();
    await searchButton.waitFor({ state: 'visible', timeout: 30_000 });
    await searchButton.click();
    await waitForHanwhaDialog(page);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    await page.keyboard.press('Tab');
    await page.keyboard.type(shipToName, { delay: 20 });
}

async function clickHanwhaNewOrderWithRetry(page: Page) {
    let lastError: unknown;

    for (let attempt = 1; attempt <= 10; attempt++) {
        try {
            const newOrderButton = page.locator(HANWHA_NEW_ORDER_SELECTOR).first();
            await newOrderButton.waitFor({ state: 'visible', timeout: 1_000 });
            await newOrderButton.click({ timeout: 1_000 });
            await page.waitForURL(/\/order\/s\/customerneworder/i, { timeout: 10_000 }).catch(() => undefined);
            return;
        } catch (error) {
            lastError = error;
            if (attempt < 10) await page.waitForTimeout(1_000);
        }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`한화 H-CRM 새 주문 버튼을 찾거나 클릭하지 못했습니다. 1초 간격으로 10회 시도 후 실패했습니다. (${message})`);
}

async function waitForHanwhaHome(page: Page): Promise<boolean> {
    try {
        await Promise.race([
            page.locator('button.comm-navigation__top-level-item-link').first().waitFor({ timeout: 30_000 }),
            page.locator(HANWHA_NEW_ORDER_SELECTOR).first().waitFor({ timeout: 30_000 }),
            page.locator('button').filter({ hasText: '새 주문' }).first().waitFor({ timeout: 30_000 }),
        ]);
        return true;
    } catch {
        return false;
    }
}

async function detectLoginFailure(page: Page): Promise<string> {
    const stillLoginVisible = await page.locator('#Login').isVisible().catch(() => false);
    const errorText = await page
        .locator('div.loginError, .error, [id*="error"], div[role="alert"]')
        .first()
        .innerText()
        .catch(() => '');

    if (stillLoginVisible) {
        return `한화 H-CRM 로그인에 실패했습니다.${errorText ? ` (${errorText.trim()})` : ''}`;
    }
    return '한화 사이트 접속/로그인이 실패했거나 새 주문 화면을 찾을 수 없습니다.';
}

export async function openHanwhaNewOrder(options: HanwhaNewOrderOptions = {}): Promise<HanwhaNewOrderResult> {
    const username = options.username ?? process.env.HANWHA_USERNAME;
    const password = options.password ?? process.env.HANWHA_PASSWORD;
    const deliveryAddressName = options.deliveryAddressName ?? null;
    const loginUrl = process.env.HANWHA_LOGIN_URL ?? 'https://h-crm.my.site.com/order';

    if (!username || !password) {
        return {
            ok: false,
            error: '한화 계정 정보가 설정되지 않았습니다.',
            errorCode: 'NO_CREDENTIALS',
        };
    }

    let browser: Browser | null = null;
    try {
        browser = await chromium.launch({ headless: false });
        const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        const page = await context.newPage();

        await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.fill('#username', username);
        await page.fill('#password', password);
        await page.click('#Login');

        if (!(await waitForHanwhaHome(page))) {
            const error = await detectLoginFailure(page);
            await browser.close();
            return { ok: false, error, errorCode: 'AUTH_FAILED' };
        }

        await clickHanwhaNewOrderWithRetry(page);

        const salesTypeInput = page
            .locator('input[placeholder*="판매형태"], input[aria-label="판매 형태"]')
            .first();
        await salesTypeInput.waitFor({ state: 'visible', timeout: 30_000 });
        await salesTypeInput.click();
        await salesTypeInput.fill('김경출');
        await pressEnterUntilDialog(page);
        await chooseFirstPopupRow(page);
        await fillShipToName(page, deliveryAddressName);

        globalForHanwhaOrder.__hanwhaOrderBrowsers ??= [];
        globalForHanwhaOrder.__hanwhaOrderBrowsers.push(browser);
        browser = null;

        return { ok: true, message: '한화 새 주문 화면 준비가 완료되었습니다. 열린 브라우저에서 이어서 입력하세요.' };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (browser) {
            try {
                await browser.close();
            } catch {
                // ignore close errors
            }
        }
        return { ok: false, error: message, errorCode: 'AUTOMATION_FAILED' };
    }
}