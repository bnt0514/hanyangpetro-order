import type { Page } from 'playwright';

const shimmedPages = new WeakSet<Page>();

const EVALUATE_NAME_SHIM = `
(() => {
  const defineNameShim = () => {
    const passthrough = (target) => target;
    try {
      Object.defineProperty(globalThis, '__name', {
        value: passthrough,
        writable: true,
        configurable: true
      });
    } catch {
      globalThis.__name = passthrough;
    }
  };
  defineNameShim();
})();
`;

export async function installPlaywrightEvaluateNameShim(page: Page) {
    if (shimmedPages.has(page)) return;
    shimmedPages.add(page);

    await page.addInitScript({ content: EVALUATE_NAME_SHIM }).catch(() => undefined);
    await page.evaluate(EVALUATE_NAME_SHIM).catch(() => undefined);
}
