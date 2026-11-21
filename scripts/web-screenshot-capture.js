#!/usr/bin/env node
'use strict';

const { chromium } = require('playwright-core');

const targetUrl = process.argv[2];
const outputPath = process.argv[3];

if (!targetUrl || !outputPath) {
  console.error('Usage: node web-screenshot-capture.js <targetUrl> <outputPath>');
  process.exit(1);
}

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true,
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    try {
      await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 25000 });
    } catch (e1) {
      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (e2) {}
    }

    // Dismiss cookie banners, modals, and overlays
    try {
      await page.evaluate(() => {
        const selectors = [
          '#onetrust-banner-sdk', '#onetrust-consent-sdk', '#CybotCookiebotDialog',
          '#hs-eu-cookie-confirmation', '.onetrust-pc-dark-filter', '.cookie-consent',
          '.cookie-banner', '.cookie-notice', '.cc-window', '.gdpr-banner',
          '[class*="cookie-banner"]', '[id*="cookie-banner"]',
          '[class*="cookie-consent"]', '[id*="cookie-consent"]',
          '[aria-label*="cookie" i]'
        ];
        for (const sel of selectors) {
          for (const el of document.querySelectorAll(sel)) {
            el.remove();
          }
        }
      });
    } catch (e) {}

    await page.waitForTimeout(1500);
    await page.screenshot({ path: outputPath, fullPage: false });
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    if (browser) await browser.close();
    process.exit(1);
  }
})();
