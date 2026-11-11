import puppeteer from 'puppeteer';

/** One shared headless Chromium instance, launched lazily on first use and reused across
 *  requests (launching Chromium per-request would be far too slow). Two deliberate hardening
 *  choices, since this renders arbitrary user-supplied HTML:
 *  - JavaScript is disabled on every page — closes most of the SSRF/abuse surface (fetch/XHR
 *    from inside the page reaching internal services) for negligible loss to the common
 *    "render my invoice/report template" use case.
 *  - Chromium's own process sandbox is left ON (no --no-sandbox) — if that fails to launch in
 *    a given deploy environment, it should throw a clear error, not silently run unsandboxed;
 *    the fix then is adding the missing sandbox helper/shared libs to that environment. */
let browserPromise;
function getBrowser() {
  if (!browserPromise) browserPromise = puppeteer.launch({ headless: true });
  return browserPromise;
}

export async function htmlToPdf(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    return await page.pdf({
      format: 'A4', printBackground: true,
      margin: { top: '40px', bottom: '40px', left: '40px', right: '40px' },
    });
  } finally {
    await page.close();
  }
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise;
  await browser.close();
}
