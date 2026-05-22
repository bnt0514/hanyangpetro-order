import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { resolveHanwhaMaterialName } from '@/lib/hanwha-material-map';

export type HanwhaNewOrderResult =
    | { ok: true; message: string }
    | { ok: false; error: string; errorCode?: 'NO_CREDENTIALS' | 'AUTH_FAILED' | 'AUTOMATION_FAILED' };

type HanwhaNewOrderOptions = {
    username?: string | null;
    password?: string | null;
    deliveryAddressName?: string | null;
    memo?: string | null;
    deliveryDate?: Date | string | null;
    items?: HanwhaNewOrderItem[];
};

type HanwhaNewOrderItem = {
    productName: string;
    productCode?: string | null;
    hanwhaMaterialName?: string | null;
    hanwhaBagType?: string | null;
    quantity: number;
    unit?: string | null;
};

const globalForHanwhaOrder = globalThis as typeof globalThis & {
    __hanwhaOrderBrowsers?: Browser[];
};

const HANWHA_NEW_ORDER_SELECTOR = "a[href='/order/s/customerneworder']";
const HANWHA_SALES_TYPE_SELECTOR = 'input[placeholder*="\uD310\uB9E4\uD615\uD0DC"], input[aria-label="\uD310\uB9E4 \uD615\uD0DC"]';
const HANWHA_SALES_REP_NAME = '\uAE40\uACBD\uCD9C';
const HANWHA_DIALOG_SELECTOR = '.slds-modal, section[role="dialog"], div[role="dialog"]';
const HANWHA_VISIBLE_DIALOG_SELECTOR = '.slds-modal:visible, section[role="dialog"]:visible, div[role="dialog"]:visible';
const HANWHA_SHIP_TO_SEARCH_SELECTOR = 'button[name="ord_ShipTo__c"]';
const HANWHA_WAIT_TIMEOUT = 300_000;

function visibleHanwhaDialog(page: Page) {
    return page.locator(HANWHA_VISIBLE_DIALOG_SELECTOR).last();
}

async function isHanwhaDialogVisible(page: Page) {
    return await page.locator(HANWHA_VISIBLE_DIALOG_SELECTOR).first().isVisible().catch(() => false);
}

async function waitForHanwhaDialog(page: Page, timeout = HANWHA_WAIT_TIMEOUT) {
    await page.locator(HANWHA_VISIBLE_DIALOG_SELECTOR).first().waitFor({ state: 'visible', timeout });
    return visibleHanwhaDialog(page);
}

async function visibleDialogCount(page: Page) {
    return await page.locator(HANWHA_VISIBLE_DIALOG_SELECTOR).count().catch(() => 0);
}

async function waitForAdditionalDialog(page: Page, previousCount: number, timeout = HANWHA_WAIT_TIMEOUT) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await visibleDialogCount(page) > previousCount) return visibleHanwhaDialog(page);
        await page.waitForTimeout(500);
    }
    throw new Error('한화 선택 팝업이 3분 안에 열리지 않았습니다.');
}

async function waitForLookupDialogClosed(page: Page, timeout = HANWHA_WAIT_TIMEOUT) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await visibleDialogCount(page) <= 1) return;
        await page.waitForTimeout(500);
    }
    throw new Error('한화 선택 팝업이 3분 안에 닫히지 않았습니다.');
}

async function openLookupPopupFromDropdown(page: Page, text: string) {
    const previousCount = await visibleDialogCount(page);

    const makeShowMoreCandidates = () => [
        page.getByText(/\uAE40\uACBD\uCD9C.*\uB354.*\uACB0\uACFC.*\uD45C\uC2DC/i).last(),
        page.getByText(/\uB354\s*\uB9CE\uC740\s*\uACB0\uACFC\s*\uD45C\uC2DC/i).last(),
        page.getByText(/more results|show more/i).last(),
        page.locator('[data-position-action-type="actionShowAll"]').last(),
        page.locator('[data-value="actionShowAll"]').last(),
        page.locator('lightning-base-combobox-item').filter({ hasText: /\uB354.*\uACB0\uACFC|more results|show more/i }).last(),
        page.locator('[role="option"], .slds-listbox__option, li, div').filter({ hasText: /\uB354.*\uACB0\uACFC|more results|show more/i }).last(),
    ];

    for (let attempt = 0; attempt < 25; attempt++) {
        for (const candidate of makeShowMoreCandidates()) {
            if (await candidate.isVisible().catch(() => false)) {
                await candidate.scrollIntoViewIfNeeded().catch(() => undefined);
                await candidate.click({ force: true });
                await waitForAdditionalDialog(page, previousCount);
                return;
            }
        }

        const matchingRow = page
            .locator('[role="option"], .slds-listbox__option, lightning-base-combobox-item, li, div')
            .filter({ hasText: text })
            .last();
        if (await matchingRow.isVisible().catch(() => false)) {
            await matchingRow.click({ force: true });
            await waitForAdditionalDialog(page, previousCount);
            return;
        }

        await page.waitForTimeout(100);
    }

    throw new Error(`Hanwha lookup dropdown did not show the more-results item for ${text}.`);
}

async function pressEnterUntilDialog(page: Page) {
    for (let attempt = 1; attempt <= 10; attempt++) {
        if (await isHanwhaDialogVisible(page)) return;
        await page.keyboard.press('Enter');
        if (await isHanwhaDialogVisible(page)) return;
        await page.waitForTimeout(1_000);
    }

    await waitForHanwhaDialog(page, HANWHA_WAIT_TIMEOUT);
}



function normalizeLookupText(value: string) {
    return value
        .toLowerCase()
        .replace(/[\s()\[\]{}.,_\-\/\\]/g, '')
        .replace(/\uC8FC\uC2DD\uD68C\uC0AC|\uC720\uD55C\uD68C\uC0AC|\u321C|\(\uC8FC\)/g, '')
        .trim();
}

function lookupSimilarityScore(source: string, target: string) {
    const a = normalizeLookupText(source);
    const b = normalizeLookupText(target);
    if (!a || !b) return 0;
    if (a === b) return 10_000;
    if (a.includes(b) || b.includes(a)) return 8_000 + Math.min(a.length, b.length);

    const bigrams = (value: string) => {
        const set = new Set<string>();
        for (let i = 0; i < value.length - 1; i++) set.add(value.slice(i, i + 2));
        return set;
    };

    const aSet = bigrams(a);
    const bSet = bigrams(b);
    if (aSet.size === 0 || bSet.size === 0) return 0;

    let overlap = 0;
    for (const token of aSet) if (bSet.has(token)) overlap++;
    return overlap * 100 - Math.abs(a.length - b.length);
}

async function chooseFirstPopupRow(page: Page, preferredText?: string | null) {
    const dialog = await waitForHanwhaDialog(page);
    await dialog.waitFor({ state: 'visible', timeout: HANWHA_WAIT_TIMEOUT });

    const rows = dialog.locator('tbody tr:visible, [role="row"]:visible').filter({ hasNotText: /^\s*$/ });
    await rows.first().waitFor({ state: 'visible', timeout: HANWHA_WAIT_TIMEOUT });
    await page.waitForTimeout(200);

    let targetRow = rows.first();
    const rowCount = await rows.count().catch(() => 0);
    const preferred = preferredText?.trim();
    if (preferred && rowCount > 1) {
        let bestIndex = 0;
        let bestScore = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < rowCount; index++) {
            const row = rows.nth(index);
            const rowText = await row.innerText().catch(() => '');
            const score = lookupSimilarityScore(rowText, preferred);
            if (score > bestScore) {
                bestScore = score;
                bestIndex = index;
            }
        }
        targetRow = rows.nth(bestIndex);
    }

    const rowRadio = targetRow.locator([
        'lightning-primitive-cell-checkbox',
        'label.slds-radio__label',
        'span.slds-radio_faux',
        'input[type="radio"]',
        '[role="radio"]',
        'label.slds-checkbox__label',
        'span.slds-checkbox_faux',
        'span.slds-checkbox--faux',
        'input[type="checkbox"]',
        '[role="checkbox"]',
        'td:first-child',
    ].join(', ')).first();

    if (await rowRadio.isVisible().catch(() => false)) {
        await rowRadio.scrollIntoViewIfNeeded().catch(() => undefined);
        await rowRadio.click({ force: true });
    } else {
        await targetRow.locator('td, [role="gridcell"]').first().click({ force: true }).catch(async () => {
            await targetRow.click({ force: true });
        });
    }

    if (preferred) {
        await targetRow.scrollIntoViewIfNeeded().catch(() => undefined);
        await targetRow.locator('td, [role="gridcell"]').nth(1).click({ force: true }).catch(async () => {
            await targetRow.click({ force: true });
        });
        await page.waitForTimeout(150);
    }

    const selectButton = dialog
        .locator('button.slds-button_brand, .slds-modal__footer button, footer button, button')
        .filter({ hasText: /^\s*(\uC120\uD0DD|\uD655\uC778|Select)\s*$/i })
        .last();
    await selectButton.waitFor({ state: 'visible', timeout: HANWHA_WAIT_TIMEOUT });

    for (let attempt = 0; attempt < 20; attempt++) {
        const ariaDisabled = await selectButton.getAttribute('aria-disabled').catch(() => null);
        if (ariaDisabled !== 'true' && await selectButton.isEnabled().catch(() => false)) break;
        await page.waitForTimeout(300);
    }

    await selectButton.click({ force: true });
    await waitForLookupDialogClosed(page);
}


async function clickBestAnchorLookupResult(page: Page, preferredText?: string | null) {
    const dialog = await waitForHanwhaDialog(page);

    // Wait for result rows to appear
    const resultRows = dialog.locator('tbody tr:visible, [role="row"]:visible').filter({ hasNotText: /^\s*$/ });
    await resultRows.first().waitFor({ state: 'visible', timeout: HANWHA_WAIT_TIMEOUT });
    // Extra wait to ensure all rows are rendered
    await page.waitForTimeout(400);

    const rowCount = await resultRows.count().catch(() => 0);
    if (rowCount === 0) throw new Error('Hanwha lookup result rows not found.');

    // Score each row by its full text and pick the best-matching one
    let bestRowIndex = 0;
    const preferred = preferredText?.trim();
    if (preferred && rowCount > 1) {
        let bestScore = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < rowCount; index++) {
            const row = resultRows.nth(index);
            const rowText = await row.innerText().catch(() => '');
            const score = lookupSimilarityScore(rowText, preferred);
            if (score > bestScore) {
                bestScore = score;
                bestRowIndex = index;
            }
        }
    }

    const targetRow = resultRows.nth(bestRowIndex);
    const targetLink = targetRow.locator('a').first();
    if (await targetLink.isVisible().catch(() => false)) {
        await targetLink.scrollIntoViewIfNeeded().catch(() => undefined);
        await targetLink.click({ force: true });
    } else {
        // Fallback: click the first clickable cell in the row
        await targetRow.locator('td, [role="gridcell"]').first().click({ force: true });
    }
    await waitForLookupDialogClosed(page);
}

async function lookupResultCount(page: Page) {
    const dialog = visibleHanwhaDialog(page);
    const rows = dialog.locator('tbody tr:visible, [role="row"]:visible').filter({ hasNotText: /^\s*$/ });
    const rowCount = await rows.count().catch(() => 0);
    if (rowCount > 0) return rowCount;
    return await dialog.locator('input[type="checkbox"]:visible, span.slds-checkbox_faux:visible').count().catch(() => 0);
}

async function fillShipToName(page: Page, deliveryAddressName?: string | null) {
    const shipToName = deliveryAddressName?.trim();
    if (!shipToName) return;

    const searchButton = page.locator(HANWHA_SHIP_TO_SEARCH_SELECTOR).first();
    await searchButton.waitFor({ state: 'visible', timeout: HANWHA_WAIT_TIMEOUT });
    const previousCount = await visibleDialogCount(page);
    await searchButton.click({ force: true });
    const dialog = await waitForAdditionalDialog(page, previousCount);
    await dialog.click({ force: true, position: { x: 20, y: 20 } }).catch(() => undefined);
    await page.waitForTimeout(500);

    const searchInput = dialog.locator([
        'input[name="search"][type="search"]',
        'input[placeholder*="\uC778\uB3C4\uCC98"][type="search"]',
        'input[placeholder*="\uAC80\uC0C9"][type="search"]',
        'input[type="search"]',
        'lightning-input input[name="search"]',
        'lightning-input input[type="search"]',
        'input.slds-input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])',
    ].join(', ')).first();

    await searchInput.waitFor({ state: 'visible', timeout: HANWHA_WAIT_TIMEOUT });
    await searchInput.click({ force: true });
    await searchInput.fill(shipToName).catch(async () => {
        await page.keyboard.press('Control+A');
        await page.keyboard.insertText(shipToName);
    });

    const modalSearchButton = dialog
        .locator('button.slds-button_brand, button')
        .filter({ hasText: /^\s*\uAC80\uC0C9\s*$/ })
        .first();
    if (await modalSearchButton.isVisible().catch(() => false)) {
        await modalSearchButton.click({ force: true });
    } else {
        await page.keyboard.press('Tab');
    }

    await page.waitForTimeout(600);
    const resultCount = await lookupResultCount(page);
    if (resultCount === 0) throw new Error('Hanwha Ship-To lookup returned no results.');
    await clickBestAnchorLookupResult(page, shipToName);
}

async function fillOrderRequestMemo(page: Page, memo?: string | null) {
    const text = memo?.trim();
    if (!text) return;

    const memoTextarea = page.locator('textarea[name="ord_Description__c"], textarea.slds-textarea').first();
    await memoTextarea.waitFor({ state: 'visible', timeout: HANWHA_WAIT_TIMEOUT });
    await memoTextarea.fill(text).catch(async () => {
        await memoTextarea.click({ force: true });
        await page.keyboard.press('Control+A');
        await page.keyboard.insertText(text);
    });

    const saveRequestButton = page.locator('button[name="Description"], button').filter({ hasText: /^\s*\uC694\uCCAD\uC0AC\uD56D\s*\uC800\uC7A5\s*$/ }).first();
    if (await saveRequestButton.isVisible().catch(() => false)) {
        await saveRequestButton.click({ force: true });
        await page.waitForTimeout(500);
    }
}

function formatHanwhaDate(value?: Date | string | null) {
    const date = value instanceof Date ? value : value ? new Date(value) : new Date();
    if (!value) date.setDate(date.getDate() + 1);
    return `${date.getFullYear()}. ${String(date.getMonth() + 1).padStart(2, '0')}. ${String(date.getDate()).padStart(2, '0')}.`;
}

function inferHanwhaMaterialName(item: HanwhaNewOrderItem) {
    return resolveHanwhaMaterialName({
        productName: item.productName,
        productCode: item.productCode,
        explicitMaterialName: item.hanwhaMaterialName,
        bagType: item.hanwhaBagType,
    });
}

async function dblClickGridCellByIndex(page: Page, row: Locator, cellIndex: number, label: string) {
    const cell = row.locator('td[role="gridcell"]').nth(cellIndex);
    await cell.waitFor({ state: 'visible', timeout: HANWHA_WAIT_TIMEOUT });
    await cell.scrollIntoViewIfNeeded().catch(() => undefined);

    const box = await cell.boundingBox().catch(() => null);
    if (!box) throw new Error(`한화 제품 행에서 ${label} 셀 위치를 찾지 못했습니다.`);

    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
}

async function selectFirstLookupResult(page: Page) {
    await page.waitForTimeout(1_000);
    const resultCount = await lookupResultCount(page);
    if (resultCount === 0) throw new Error('한화 검색 결과가 없습니다.');
    await chooseFirstPopupRow(page);
}

async function fillProductLookup(page: Page, materialName: string) {
    const dialog = await waitForHanwhaDialog(page);
    const searchInput = dialog.locator([
        'input[name="search"][type="search"]',
        'input[placeholder*="\uC81C\uD488"][type="search"]',
        'input[placeholder*="\uAC80\uC0C9"][type="search"]',
        'input[type="search"]',
        'lightning-input input[name="search"]',
        'lightning-input input[type="search"]',
    ].join(', ')).first();

    await searchInput.waitFor({ state: 'visible', timeout: HANWHA_WAIT_TIMEOUT });
    await searchInput.click({ force: true });
    await searchInput.fill(materialName).catch(async () => {
        await page.keyboard.press('Control+A');
        await page.keyboard.insertText(materialName);
    });

    const modalSearchButton = dialog
        .locator('button.slds-button_brand, button')
        .filter({ hasText: /^\s*\uAC80\uC0C9\s*$/ })
        .first();
    if (await modalSearchButton.isVisible().catch(() => false)) {
        await modalSearchButton.click({ force: true });
    } else {
        await page.keyboard.press('Tab');
    }

    // Wait 500ms and if dialog is still open (search not triggered), click search button or Tab again
    await page.waitForTimeout(500);
    const dialogStillOpen = await dialog.isVisible().catch(() => false);
    if (dialogStillOpen) {
        const hasResults = await dialog.locator('a[href="javascript:void(0)"]').first().isVisible().catch(() => false);
        if (!hasResults) {
            if (await modalSearchButton.isVisible().catch(() => false)) {
                await modalSearchButton.click({ force: true });
            } else {
                await searchInput.click({ force: true });
                await page.keyboard.press('Tab');
            }
            await page.waitForTimeout(500);
        }
    }

    await clickBestAnchorLookupResult(page, materialName);
}

async function fillProductQuantityAndDate(page: Page, item: HanwhaNewOrderItem, deliveryDateText: string) {
    const dialog = visibleHanwhaDialog(page);
    const productRow = dialog.locator('tr.cOrderProductsTableList:visible').last();
    await productRow.waitFor({ state: 'visible', timeout: HANWHA_WAIT_TIMEOUT });

    await dblClickGridCellByIndex(page, productRow, 2, 'quantity');

    await page.waitForTimeout(200);
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(String(item.quantity));
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    const dateDisplay = productRow
        .locator('div[title]:visible')
        .filter({ has: page.locator('lightning-formatted-date-time') })
        .last();
    await dateDisplay.waitFor({ state: 'visible', timeout: HANWHA_WAIT_TIMEOUT });

    const currentDateTitle = await dateDisplay.getAttribute('title').catch(() => '');
    let currentDateFormatted = '';
    if (currentDateTitle && /^\d{4}-\d{2}-\d{2}$/.test(currentDateTitle)) {
        const [year, month, day] = currentDateTitle.split('-');
        currentDateFormatted = `${year}. ${month}. ${day}.`;
    }

    if (currentDateFormatted === deliveryDateText) return;

    await dateDisplay.scrollIntoViewIfNeeded().catch(() => undefined);
    const box = await dateDisplay.boundingBox().catch(() => null);
    if (!box) throw new Error('Hanwha delivery date cell position was not found.');

    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(500);
    // Click once more to focus the date input field that appears after double-click
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(deliveryDateText);
    // Use Tab instead of Enter to confirm the date without risking form submission bubbling
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
}

async function fillHanwhaProducts(page: Page, items: HanwhaNewOrderItem[] | undefined, deliveryDate?: Date | string | null) {
    if (!items?.length) return;
    const deliveryDateText = formatHanwhaDate(deliveryDate);

    for (const item of items) {
        const materialName = inferHanwhaMaterialName(item);
        const dialog = visibleHanwhaDialog(page);

        // Count existing rows before clicking 제품 추가 so we can wait for the new row
        const rowsBefore = await dialog.locator('tr.cOrderProductsTableList:visible').count().catch(() => 0);

        const addButton = page.locator('button').filter({ hasText: /^\s*\uC81C\uD488\s*\uCD94\uAC00\s*$/ }).last();
        await addButton.waitFor({ state: 'visible', timeout: HANWHA_WAIT_TIMEOUT });
        await addButton.click({ force: true });

        // Wait for a new row to appear (row count must exceed previous count)
        const deadline = Date.now() + HANWHA_WAIT_TIMEOUT;
        while (Date.now() < deadline) {
            const rowsNow = await dialog.locator('tr.cOrderProductsTableList:visible').count().catch(() => 0);
            if (rowsNow > rowsBefore) break;
            await page.waitForTimeout(300);
        }

        const productRow = dialog.locator('tr.cOrderProductsTableList:visible').last();
        await productRow.waitFor({ state: 'visible', timeout: HANWHA_WAIT_TIMEOUT });
        await dblClickGridCellByIndex(page, productRow, 1, 'productName');

        await fillProductLookup(page, materialName);
        await fillProductQuantityAndDate(page, item, deliveryDateText);
    }

    const saveButton = visibleHanwhaDialog(page).locator('button').filter({ hasText: /^\uC800\uC7A5$/ }).last();
    await saveButton.waitFor({ state: 'visible', timeout: HANWHA_WAIT_TIMEOUT });
    await saveButton.click();
    await waitForLookupDialogClosed(page);
}

async function requestHanwhaOrder(page: Page) {
    const deadline = Date.now() + HANWHA_WAIT_TIMEOUT;
    let lastError: unknown = null;

    while (Date.now() < deadline) {
        await page.waitForLoadState('domcontentloaded').catch(() => undefined);
        await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => undefined);

        const requestButton = page
            .locator('button[name="Order.SubmitOrder"], button')
            .filter({ hasText: /^\s*\uC8FC\uBB38\s*\uC694\uCCAD\s*$/ })
            .last();

        try {
            if (await requestButton.isVisible({ timeout: 500 }).catch(() => false)) {
                const ariaDisabled = await requestButton.getAttribute('aria-disabled').catch(() => null);
                const disabled = await requestButton.isDisabled().catch(() => false);
                if (ariaDisabled !== 'true' && !disabled) {
                    await requestButton.scrollIntoViewIfNeeded().catch(() => undefined);
                    await requestButton.click({ force: true });
                    return;
                }
            }
        } catch (error) {
            lastError = error;
        }

        await page.waitForTimeout(500);
    }

    throw new Error(`Hanwha submit order button could not be clicked. ${lastError instanceof Error ? lastError.message : ''}`.trim());
}


async function findPageWithSalesTypeInput(context: BrowserContext, preferredPage: Page, timeout = 20_000): Promise<Page | null> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const pages = [preferredPage, ...context.pages().filter((candidate) => candidate !== preferredPage)];
        for (const candidate of pages) {
            const input = candidate.locator(HANWHA_SALES_TYPE_SELECTOR).first();
            if (await input.isVisible().catch(() => false)) return candidate;
        }
        await preferredPage.waitForTimeout(250);
    }
    return null;
}

async function focusNewestOrDialogPage(context: BrowserContext, preferredPage: Page): Promise<Page> {
    const pages = context.pages();
    const newestPage = pages[pages.length - 1] ?? preferredPage;
    const targetPage = newestPage.isClosed() ? preferredPage : newestPage;
    await targetPage.bringToFront().catch(() => undefined);

    const dialog = targetPage.locator(HANWHA_VISIBLE_DIALOG_SELECTOR).last();
    if (await dialog.isVisible().catch(() => false)) {
        await dialog.click({ force: true, position: { x: 20, y: 20 } }).catch(() => undefined);
    } else {
        await targetPage.locator('body').click({ force: true, position: { x: 30, y: 30 } }).catch(() => undefined);
    }

    return targetPage;
}

async function waitForNewOrderSurface(context: BrowserContext, preferredPage: Page, timeout = 20_000): Promise<Page | null> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const pages = [preferredPage, ...context.pages().filter((candidate) => candidate !== preferredPage)];
        for (const candidate of pages) {
            if (await candidate.locator(HANWHA_SALES_TYPE_SELECTOR).first().isVisible().catch(() => false)) {
                await candidate.bringToFront().catch(() => undefined);
                return candidate;
            }
            if (await candidate.locator(HANWHA_VISIBLE_DIALOG_SELECTOR).last().isVisible().catch(() => false)) {
                const focused = await focusNewestOrDialogPage(context, candidate);
                if (await focused.locator(HANWHA_SALES_TYPE_SELECTOR).first().isVisible().catch(() => false)) return focused;
            }
        }
        await preferredPage.waitForTimeout(250);
    }
    return null;
}

async function clickHanwhaNewOrderWithRetry(page: Page): Promise<Page> {
    const context = page.context();

    const alreadyOpenPage = await findPageWithSalesTypeInput(context, page, 2_000);
    if (alreadyOpenPage) {
        await alreadyOpenPage.bringToFront().catch(() => undefined);
        return alreadyOpenPage;
    }

    const candidates = [
        page.locator(HANWHA_NEW_ORDER_SELECTOR).first(),
        page.locator('a[href*="customerneworder"]').first(),
        page.getByRole('button', { name: /\uC0C8\s*\uC8FC\uBB38/ }).first(),
        page.getByRole('link', { name: /\uC0C8\s*\uC8FC\uBB38/ }).first(),
        page.getByText(/\uC0C8\s*\uC8FC\uBB38/).first(),
        page.locator('[title*="\uC0C8 \uC8FC\uBB38"], [aria-label*="\uC0C8 \uC8FC\uBB38"]').first(),
    ];

    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(500);

    for (const candidate of candidates) {
        if (!await candidate.isVisible().catch(() => false)) continue;

        const pagePromise = context.waitForEvent('page', { timeout: 700 }).catch(() => null);
        await candidate.scrollIntoViewIfNeeded().catch(() => undefined);
        await candidate.click({ force: true });

        const popupPage = await pagePromise;
        if (popupPage) {
            await popupPage.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
            await popupPage.bringToFront().catch(() => undefined);
            await popupPage.locator('body').click({ force: true, position: { x: 30, y: 30 } }).catch(() => undefined);
        }

        const surfacePage = await waitForNewOrderSurface(context, popupPage ?? page, 20_000);
        if (surfacePage) return surfacePage;

        break;
    }

    throw new Error('[새 주문 화면] 한화 H-CRM 새 주문 화면을 열지 못했습니다. 메뉴 또는 팝업 상태를 확인해주세요.');
}

async function runHanwhaStep<T>(label: string, fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith(`[${label}]`)) throw error;
        throw new Error(`[${label}] ${message}`);
    }
}

async function waitForHanwhaHome(page: Page): Promise<boolean> {
    try {
        await Promise.race([
            page.locator('button.comm-navigation__top-level-item-link').first().waitFor({ timeout: HANWHA_WAIT_TIMEOUT }),
            page.locator(HANWHA_NEW_ORDER_SELECTOR).first().waitFor({ timeout: HANWHA_WAIT_TIMEOUT }),
            page.locator('button').filter({ hasText: '새 주문' }).first().waitFor({ timeout: HANWHA_WAIT_TIMEOUT }),
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
    const memo = options.memo ?? null;
    const items = options.items ?? [];
    const deliveryDate = options.deliveryDate ?? null;
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

        const activePage = await runHanwhaStep('새 주문 화면', () => clickHanwhaNewOrderWithRetry(page));

        const salesTypeInput = activePage.locator(HANWHA_SALES_TYPE_SELECTOR).first();
        await runHanwhaStep('판매형태 지점', async () => {
            await salesTypeInput.waitFor({ state: 'visible', timeout: HANWHA_WAIT_TIMEOUT });
            await salesTypeInput.click();
            await salesTypeInput.fill(HANWHA_SALES_REP_NAME);
            await activePage.waitForTimeout(100); // 드롭다운 표시 대기
            await openLookupPopupFromDropdown(activePage, HANWHA_SALES_REP_NAME);
            await chooseFirstPopupRow(activePage);
        });
        await runHanwhaStep('인도처명', () => fillShipToName(activePage, deliveryAddressName));
        await runHanwhaStep('요청사항', () => fillOrderRequestMemo(activePage, memo));
        await runHanwhaStep('제품', () => fillHanwhaProducts(activePage, items, deliveryDate));
        await runHanwhaStep('주문요청', () => requestHanwhaOrder(activePage));

        globalForHanwhaOrder.__hanwhaOrderBrowsers ??= [];
        globalForHanwhaOrder.__hanwhaOrderBrowsers.push(browser);
        browser = null;

        return { ok: true, message: '한화 주문요청까지 자동 진행했습니다. 열린 브라우저에서 결과를 확인하세요.' };
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
