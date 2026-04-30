/**
 * 한화전산시스템(H-CRM) 출고/배차 정보 스크래퍼
 * --------------------------------------------------------------
 * Python(Selenium) 기반 기존 자동화를 Playwright로 포팅.
 * 인도처별 Line 정보의 모든 셀(td)을 통째로 가져온다.
 *
 * 사용 예:
 *   const result = await scrapeHanwhaDispatch('2026-04-30');
 */
import { chromium, type Browser, type Page } from 'playwright';

export interface ScrapedLine {
    /** 자재명(원본) */
    materialNameRaw: string | null;
    /** 한양 표기로 변환한 자재명 */
    materialName: string | null;
    /** 출고 수량 (kg) */
    quantityKg: number | null;
    /** Line 행의 모든 td 텍스트 (원본 그대로) */
    rawCells: string[];
}

export interface ScrapedIndoChi {
    indoChiIndex: number;
    indoChiName: string;
    lines: ScrapedLine[];
}

export type ScrapeErrorCode = 'AUTH_FAILED' | 'TIMEOUT' | 'NO_DATE_INPUT' | 'UNKNOWN' | 'NO_CREDENTIALS';

export interface ScrapeResult {
    ok: boolean;
    rows: ScrapedIndoChi[];
    error?: string;
    errorCode?: ScrapeErrorCode;
}

export interface ScrapeOptions {
    /** DB에서 로드한 자격증명 (없으면 .env 사용) */
    username?: string | null;
    password?: string | null;
}

/**
 * "2026-04-30" → "2026. 4. 30."  (한화 input 포맷)
 */
function toHanwhaDate(isoDate: string): string {
    const [y, m, d] = isoDate.split('-').map(Number);
    return `${y}. ${m}. ${d}.`;
}

/**
 * MF_LD_953 → LDPE<953>  같은 한양 자재명 변환
 */
function convertMaterialName(name: string): string {
    if (!name) return name;
    let s = name;
    if (s.startsWith('MF_')) s = s.slice(3);
    s = s.replace(/_/g, ' ');
    const map: Record<string, string> = {
        LD: 'LDPE',
        LLD: 'LLDPE',
        mLLD: 'mLLDPE',
        HD: 'HDPE',
        EVA: 'EVA',
    };
    const parts = s.split(' ');
    if (parts[0] in map && parts[1]) {
        return `${map[parts[0]]}<${parts[1]}>`;
    }
    return s;
}

export async function scrapeHanwhaDispatch(
    isoDate: string,
    opts: ScrapeOptions = {},
): Promise<ScrapeResult> {
    const username = opts.username ?? process.env.HANWHA_USERNAME;
    const password = opts.password ?? process.env.HANWHA_PASSWORD;
    const loginUrl = process.env.HANWHA_LOGIN_URL ?? 'https://h-crm.my.site.com/order';
    const headless = process.env.HANWHA_HEADLESS !== 'false';

    if (!username || !password) {
        return {
            ok: false,
            rows: [],
            error: '한화 계정 정보가 설정되지 않았습니다.',
            errorCode: 'NO_CREDENTIALS',
        };
    }

    const hanwhaDate = toHanwhaDate(isoDate);
    let browser: Browser | null = null;

    try {
        browser = await chromium.launch({ headless });
        const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        const page: Page = await ctx.newPage();

        // 1) 로그인
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.fill('#username', username);
        await page.fill('#password', password);
        await page.click('#Login');

        // 2) 메뉴 → 주문진척현황 (인증 실패 감지)
        try {
            await page.waitForSelector('button.comm-navigation__top-level-item-link', { timeout: 25_000 });
        } catch {
            // 로그인 페이지 잔존/에러 메시지 노출 여부 확인
            const stillLoginVisible = await page.locator('#Login').isVisible().catch(() => false);
            const errorText = await page
                .locator('div.loginError, .error, [id*="error"], div[role="alert"]')
                .first()
                .innerText()
                .catch(() => '');
            await browser.close();
            return {
                ok: false,
                rows: [],
                errorCode: 'AUTH_FAILED',
                error: stillLoginVisible
                    ? `한화 H-CRM 로그인에 실패했습니다. 비밀번호가 변경되었을 수 있습니다.${errorText ? ' (' + errorText.trim() + ')' : ''}`
                    : '한화 사이트 접속/로그인이 실패했거나 메뉴를 찾을 수 없습니다.',
            };
        }
        await page.click('button.comm-navigation__top-level-item-link');
        await page.waitForSelector("a[href='/order/s/OrderProgressCheck']", { timeout: 30_000 });
        await page.click("a[href='/order/s/OrderProgressCheck']");

        // 3) 날짜 입력 (시작일/종료일 동일)
        await page.waitForSelector("input.slds-input[type='text']", { timeout: 30_000 });
        const dateInputs = page.locator("input.slds-input[type='text']");
        const inputCount = await dateInputs.count();
        if (inputCount < 2) {
            throw new Error(`날짜 입력 필드를 찾지 못했습니다. (count=${inputCount})`);
        }
        for (let i = 0; i < 2; i++) {
            const handle = await dateInputs.nth(i).elementHandle();
            if (!handle) continue;
            await page.evaluate(
                ({ el, val }) => {
                    const input = el as HTMLInputElement;
                    input.value = val;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    input.dispatchEvent(new Event('blur', { bubbles: true }));
                },
                { el: handle, val: hanwhaDate },
            );
        }

        // 4) 검색
        await page.click("button.slds-button_brand.header-input[title='검색']");
        await page.waitForTimeout(2000);

        // 5) 무한 스크롤로 모든 행 로드
        let lastHeight = (await page.evaluate(() => document.body.scrollHeight)) as number;
        for (let attempt = 0; attempt < 30; attempt++) {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(800);
            const newHeight = (await page.evaluate(() => document.body.scrollHeight)) as number;
            if (newHeight === lastHeight) break;
            lastHeight = newHeight;
        }

        // 6) 인도처별 클릭 → Line 정보 수집
        const rowCount = await page.locator('tbody tr').count();
        const result: ScrapedIndoChi[] = [];
        // 마지막 유령 행 제외 (Python 코드와 동일)
        const realCount = Math.max(0, rowCount - 1);

        for (let idx = 0; idx < realCount; idx++) {
            const rowLoc = page.locator('tbody tr').nth(idx);
            const indoChiCell = rowLoc.locator('td:nth-child(6) div').first();
            if ((await indoChiCell.count()) === 0) continue;
            const indoChiName = (await indoChiCell.getAttribute('title')) ?? '';

            // 인도처 클릭
            await rowLoc.locator('td:nth-child(6)').click();
            await page.waitForTimeout(1200);

            // Line 정보 테이블의 모든 행
            const lineRows = page.locator('div.req-wrap tbody tr');
            const lineCount = await lineRows.count();
            const lines: ScrapedLine[] = [];

            for (let li = 0; li < lineCount; li++) {
                const lineRow = lineRows.nth(li);
                const cells = lineRow.locator('td');
                const cellCount = await cells.count();
                const rawCells: string[] = [];
                for (let ci = 0; ci < cellCount; ci++) {
                    const cell = cells.nth(ci);
                    // div의 title 우선, 없으면 텍스트
                    const div = cell.locator('div').first();
                    let value = '';
                    if ((await div.count()) > 0) {
                        value = (await div.getAttribute('title')) ?? (await div.innerText()) ?? '';
                    } else {
                        value = (await cell.innerText()) ?? '';
                    }
                    rawCells.push(value.trim());
                }

                // 알려진 컬럼 위치: 자재명=3번, 수량=7번 (1-based)
                const materialRaw = rawCells[2] ?? null;
                const qtyRaw = rawCells[6] ?? '';
                const qtyNum = qtyRaw && /^[\d.,]+$/.test(qtyRaw)
                    ? parseFloat(qtyRaw.replace(/,/g, ''))
                    : null;

                lines.push({
                    materialNameRaw: materialRaw,
                    materialName: materialRaw ? convertMaterialName(materialRaw) : null,
                    quantityKg: Number.isFinite(qtyNum) ? (qtyNum as number) : null,
                    rawCells,
                });
            }

            result.push({ indoChiIndex: idx + 1, indoChiName, lines });
        }

        await browser.close();
        return { ok: true, rows: result };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (browser) {
            try {
                await browser.close();
            } catch {
                /* ignore */
            }
        }
        return { ok: false, rows: [], error: msg, errorCode: 'UNKNOWN' };
    }
}
