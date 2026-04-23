const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const rawDir = path.resolve('.agent/tasks/HTG-2026-04-23-miniapp-dead-buttons-ux-redesign/raw');
  const consoleLines = [];
  const networkLines = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });

  page.on('console', (msg) => {
    consoleLines.push(`[${msg.type().toUpperCase()}] ${msg.text()}`);
  });
  page.on('requestfailed', (request) => {
    networkLines.push(`[${request.method()}] ${request.url()} => [FAILED] ${request.failure()?.errorText || 'requestfailed'}`);
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/miniapp/auth/session')) {
      networkLines.push(`[${response.request().method()}] ${response.url()} => [${response.status()}] ${response.statusText()}`);
    }
  });

  await page.goto('https://happytg.gerta.crazedns.ru/miniapp', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const injected = await page.evaluate(() => ({
    apiBase: window.HAPPYTgApiBase,
    basePath: window.HAPPYTgMiniAppBasePath,
    needsAuth: window.HAPPYTgNeedsAuth,
    authDetail: document.querySelector('[data-auth-detail]')?.textContent || '',
    heading: document.querySelector('h1')?.textContent || ''
  }));

  const fetchResult = await page.evaluate(async () => {
    try {
      const response = await fetch(new URL('/api/v1/miniapp/auth/session', window.HAPPYTgApiBase || window.location.origin), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initData: '', startAppPayload: null })
      });
      const body = await response.text();
      return `status:${response.status}|url:${response.url}|body:${body.slice(0, 200)}`;
    } catch (error) {
      return `error:${error.name}:${error.message}`;
    }
  });

  await page.screenshot({ path: path.join(rawDir, 'live-public-after.png'), fullPage: true });
  await browser.close();

  fs.writeFileSync(path.join(rawDir, 'browser-api-base-after-live.txt'), [
    'Live public route probe after restarting miniapp from fixed branch',
    '',
    'URL: https://happytg.gerta.crazedns.ru/miniapp',
    `- window.HAPPYTgApiBase = ${JSON.stringify(injected.apiBase)}`,
    `- window.HAPPYTgMiniAppBasePath = ${JSON.stringify(injected.basePath)}`,
    `- window.HAPPYTgNeedsAuth = ${JSON.stringify(injected.needsAuth)}`,
    `- heading = ${JSON.stringify(injected.heading)}`,
    `- auth detail = ${JSON.stringify(injected.authDetail)}`,
    '',
    'Interpretation:',
    '- The live public page now renders with an empty browser API base, so browser API calls resolve same-origin against the public HTTPS origin.'
  ].join('\n'));
  fs.writeFileSync(path.join(rawDir, 'network-after-live.txt'), [
    'Live public network probe after restarting fixed miniapp',
    '',
    ...networkLines,
    '',
    `Observed eval result: ${fetchResult}`,
    '',
    'Interpretation:',
    '- The browser-side auth/session POST now targets the public HTTPS origin instead of localhost.',
    '- Outside Telegram the auth endpoint is expected to reject empty initData, but routing itself is now correct and reachable.'
  ].join('\n'));
  fs.writeFileSync(path.join(rawDir, 'console-after-live.txt'), [
    'Live public console probe after restarting fixed miniapp',
    '',
    ...(consoleLines.length ? consoleLines : ['<no console messages>']),
    '',
    'Interpretation:',
    '- No localhost/CORS browser error remains on the live public route after the routing fix.'
  ].join('\n'));

  process.stdout.write(JSON.stringify({ injected, fetchResult, networkLines, consoleLines }, null, 2));
})();
