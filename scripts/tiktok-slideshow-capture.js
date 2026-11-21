#!/usr/bin/env node
'use strict';

/**
 * TikTok slideshow screenshot capture.
 *
 * Runs inside the Playwright Docker image (or any environment with
 * playwright-core + Chromium available). It captures a sequence of
 * mobile 9:16 frames from a live project page, optionally followed by
 * frames from the WordPress article page, and writes a meta.json
 * describing what is visible in each frame so the AI can write a
 * matching voice-over.
 *
 * Usage:
 *   node tiktok-slideshow-capture.js \
 *     --url https://example.com \
 *     --fallback-url https://wordpress.example.com/article \
 *     --out-dir /out \
 *     --project-id example \
 *     --project-name "Example App" \
 *     --max-slides 6
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const targetUrl = typeof args.url === 'string' ? args.url : '';
const fallbackUrl = typeof args['fallback-url'] === 'string' ? args['fallback-url'] : '';
const outDir = typeof args['out-dir'] === 'string' ? args['out-dir'] : '/out';
const projectId = typeof args['project-id'] === 'string' ? args['project-id'] : 'project';
const projectName = typeof args['project-name'] === 'string' ? args['project-name'] : 'Project';
const maxSlides = Math.max(1, Math.min(10, parseInt(args['max-slides'], 10) || 6));
const loginConfigPath = typeof args['login-config'] === 'string' ? args['login-config'] : '';
const accountId = typeof args.account === 'string' ? args.account : projectId;
const requireLogin = Boolean(args['require-login']);

const VIEWPORT = { width: 540, height: 960 };
const DEVICE_SCALE_FACTOR = 2;
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

function log(message) {
  console.log(`[TikTok Capture] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dismissCookieAndConsentBanners(page) {
  try {
    await page.evaluate(() => {
      const selectors = [
        '#onetrust-banner-sdk',
        '#onetrust-consent-sdk',
        '#CybotCookiebotDialog',
        '#hs-eu-cookie-confirmation',
        '.onetrust-pc-dark-filter',
        '.cookie-consent',
        '.cookie-banner',
        '.cookie-notice',
        '.cc-window',
        '.gdpr-banner',
        '[class*="cookie-banner"]',
        '[id*="cookie-banner"]',
        '[class*="cookie-consent"]',
        '[id*="cookie-consent"]',
        '[aria-label*="cookie" i]'
      ];

      for (const el of document.querySelectorAll(selectors.join(','))) {
        const rect = el.getBoundingClientRect();
        if (rect.height < window.innerHeight * 0.85) {
          el.remove();
        }
      }

      // Some sites use an unnamed fixed bottom bar for consent.
      for (const el of document.querySelectorAll('div, section, aside')) {
        const style = window.getComputedStyle(el);
        if (style.position !== 'fixed' && style.position !== 'sticky') continue;
        if (parseFloat(style.zIndex || '0') < 50) continue;
        const rect = el.getBoundingClientRect();
        if (rect.height <= 0 || rect.height > window.innerHeight * 0.55) continue;
        if (rect.bottom < window.innerHeight - 120) continue;
        const text = (el.innerText || '').toLowerCase();
        if (/(cookie|consent|privacy settings|accept all)/i.test(text)) {
          el.remove();
        }
      }
    });
  } catch (err) {
    // Non-fatal; screenshots can proceed with the banner.
  }
}

async function waitForPageReady(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 12000 });
  } catch (err) {
    // Some SPAs never reach networkidle. A fixed pause is enough.
  }
  await page.waitForTimeout(1200);
  try {
    await page.evaluate(() => document.fonts && document.fonts.ready);
  } catch (err) {}
  await page.waitForTimeout(400);
}

async function warmUpLazyContent(page) {
  try {
    await page.evaluate(async () => {
      const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const height = Math.max(
        document.body ? document.body.scrollHeight : 0,
        document.documentElement ? document.documentElement.scrollHeight : 0
      );
      const step = Math.max(320, Math.floor(window.innerHeight * 0.8));
      for (let y = 0; y < height; y += step) {
        window.scrollTo(0, y);
        await sleepInPage(100);
      }
      window.scrollTo(0, 0);
      await sleepInPage(250);
    });
  } catch (err) {}
  await page.waitForTimeout(700);
}

async function detectScrollSurface(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const documentMax =
      Math.max(
        body ? body.scrollHeight : 0,
        body ? body.offsetHeight : 0,
        doc ? doc.scrollHeight : 0,
        doc ? doc.offsetHeight : 0
      ) - window.innerHeight;

    if (documentMax > 140) {
      return { maxScroll: documentMax, container: false };
    }

    let best = null;
    for (const el of document.querySelectorAll('body *')) {
      const style = window.getComputedStyle(el);
      if (!/(auto|scroll)/.test(style.overflowY)) continue;
      if (el.scrollHeight <= el.clientHeight + 140) continue;
      if (el.clientHeight < Math.min(280, window.innerHeight * 0.35)) continue;
      const area = el.clientHeight * el.clientWidth;
      if (!best || area > best.area) {
        best = { el, area };
      }
    }

    if (best) {
      best.el.setAttribute('data-openclaw-scroll', '1');
      return {
        maxScroll: best.el.scrollHeight - best.el.clientHeight,
        container: true
      };
    }

    return { maxScroll: 0, container: false };
  });
}

async function scrollSurface(page, top, container) {
  await page.evaluate(
    ({ nextTop, useContainer }) => {
      if (useContainer) {
        const el = document.querySelector('[data-openclaw-scroll="1"]');
        if (el) {
          el.scrollTop = nextTop;
          return;
        }
      }
      window.scrollTo({ top: nextTop, left: 0, behavior: 'instant' });
    },
    { nextTop: top, useContainer: container }
  );
  await page.waitForTimeout(450);
}

async function extractVisibleContent(page) {
  return page.evaluate(() => {
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      if (rect.bottom < 0 || rect.top > vh) return false;
      if (rect.right < 0 || rect.left > vw) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      if (parseFloat(style.opacity || '1') < 0.05) return false;
      return true;
    }

    const headings = [];
    for (const el of document.querySelectorAll('h1, h2, h3, [role="heading"]')) {
      if (!isVisible(el)) continue;
      const text = (el.innerText || '').trim().replace(/\s+/g, ' ');
      if (text && text.length <= 180 && !headings.includes(text)) {
        headings.push(text);
      }
      if (headings.length >= 6) break;
    }

    const textChunks = [];
    for (const el of document.querySelectorAll('p, li, button, a, span')) {
      if (!isVisible(el)) continue;
      if (el.children.length > 0) continue;
      const text = (el.innerText || '').trim().replace(/\s+/g, ' ');
      if (!text || text.length < 8 || text.length > 240) continue;
      if (/(cookie|consent|privacy settings|accept all)/i.test(text)) continue;
      if (!textChunks.includes(text)) {
        textChunks.push(text);
      }
      if (textChunks.length >= 20) break;
    }

    return {
      title: document.title || '',
      headings: headings.slice(0, 5),
      text: textChunks.join(' • ').slice(0, 1400)
    };
  });
}

function normalizeTextKey(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 120)
    .join(' ');
}

function buildPositions(maxScroll, count) {
  if (count <= 1 || maxScroll <= 20) return [0];
  // Stop short of the absolute bottom so the last frame shows a useful
  // feature / CTA section instead of the footer and legal links.
  const usableRange = Math.round(maxScroll * 0.82);
  const positions = [];
  for (let i = 0; i < count; i += 1) {
    const ratio = i / (count - 1);
    positions.push(Math.round(usableRange * ratio));
  }
  return [...new Set(positions)];
}

function loadAccountConfig() {
  if (!loginConfigPath) return null;
  if (!fs.existsSync(loginConfigPath)) {
    log(`Login config not found at ${loginConfigPath}; capturing public pages.`);
    return null;
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(loginConfigPath, 'utf8'));
  } catch (err) {
    log(`Could not parse login config: ${err.message}; capturing public pages.`);
    return null;
  }

  const account = config[accountId] || config[projectId];
  if (!account) return null;
  if (!account.login_url || !account.fields || !account.submit) {
    log(`Login config for ${accountId} is incomplete; capturing public pages.`);
    return null;
  }
  return account;
}

async function performLogin(page, account) {
  const info = {
    attempted: true,
    authenticated: false,
    login_url: account.login_url,
    final_url: null,
    error: null
  };

  try {
    log(`Signing in as OpenClaw account for ${accountId}...`);
    await page.goto(account.login_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForPageReady(page);
    await dismissCookieAndConsentBanners(page);

    for (const step of account.pre_steps || []) {
      if (!step.click) continue;
      const target = page.locator(step.click).first();
      await target.waitFor({ state: 'visible', timeout: 15000 });
      await target.click();
      await page.waitForTimeout(step.wait_ms || 800);
    }

    for (const [selector, value] of Object.entries(account.fields)) {
      const field = page.locator(selector).first();
      await field.waitFor({ state: 'visible', timeout: 15000 });
      await field.fill(value);
      await page.waitForTimeout(100);
    }

    const submit = page.locator(account.submit).first();
    await submit.waitFor({ state: 'visible', timeout: 15000 });
    await submit.click();
    await page.waitForTimeout(1500);
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 8000 });
    } catch (err) {}

    const loginPath = new URL(account.login_url).pathname;
    const deadline = Date.now() + 20000;

    while (Date.now() < deadline) {
      let bodyText = '';
      try {
        bodyText = await page.evaluate(() => (document.body ? document.body.innerText : '') || '');
      } catch (err) {
        await page.waitForTimeout(500);
        continue;
      }
      const authError =
        bodyText.match(/HTTP \d{3}/i) ||
        bodyText.match(
          /(unexpected response|invalid (?:email|password|credentials)|incorrect (?:email|password)|login failed|server error|account not found)/i
        );
      if (authError) {
        info.error = authError[0];
        break;
      }

      if (
        account.success_selector &&
        (await page.locator(account.success_selector).first().isVisible().catch(() => false))
      ) {
        info.authenticated = true;
        break;
      }

      if (account.success_text && bodyText.includes(account.success_text)) {
        info.authenticated = true;
        break;
      }

      if (loginPath !== '/' && !new URL(page.url()).pathname.includes(loginPath)) {
        info.authenticated = true;
        break;
      }

      await page.waitForTimeout(500);
    }

    info.final_url = page.url();
    if (info.authenticated) {
      log('Signed in successfully.');
    } else {
      log(`Sign-in did not complete${info.error ? ` (${info.error})` : ''}. Capturing public pages.`);
    }
  } catch (err) {
    info.final_url = page.url();
    info.error = err.message;
    log(`Sign-in failed (${err.message}). Capturing public pages.`);
  }

  return info;
}

async function capturePageFrames(page, pageUrl, limit, source, frames, seenKeys, timestamp) {
  if (limit <= 0 || frames.length >= maxSlides) return;

  log(`Opening ${source} page: ${pageUrl}`);
  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (err) {
    if (/interrupted by another navigation/i.test(err.message)) {
      await page.waitForTimeout(1500);
    } else {
      throw err;
    }
  }
  await waitForPageReady(page);
  await dismissCookieAndConsentBanners(page);
  await warmUpLazyContent(page);

  const surface = await detectScrollSurface(page);
  const remaining = Math.min(limit, maxSlides - frames.length);
  const positions = buildPositions(surface.maxScroll, remaining);
  log(
    `${source} page: scrollable height ${surface.maxScroll}px, using ${surface.container ? 'inner container' : 'window'} surface, capturing ${positions.length} frame(s).`
  );

  for (const position of positions) {
    if (frames.length >= maxSlides) break;

    await scrollSurface(page, position, surface.container);
    await dismissCookieAndConsentBanners(page);
    await page.waitForTimeout(350);

    const visible = await extractVisibleContent(page);
    const key = normalizeTextKey(`${visible.headings.join(' ')} ${visible.text}`);
    if (key && seenKeys.has(key)) {
      log(`Skipping duplicate frame at ${position}px (same visible content as an earlier frame).`);
      continue;
    }
    if (key) seenKeys.add(key);

    const filename = `${projectId}_tiktok_${timestamp}_${String(frames.length + 1).padStart(2, '0')}.png`;
    const filePath = path.join(outDir, filename);

    await page.screenshot({
      path: filePath,
      animations: 'disabled',
      caret: 'hide'
    });

    frames.push({
      order: frames.length + 1,
      filename,
      source,
      url: pageUrl,
      scroll_top: position,
      title: visible.title,
      headings: visible.headings,
      text: visible.text
    });
    log(`Captured slide ${frames.length}/${maxSlides}: ${filename}`);
  }
}

async function main() {
  if (!targetUrl) {
    throw new Error('Missing required --url argument.');
  }

  fs.mkdirSync(outDir, { recursive: true });
  const timestamp = Date.now();
  const frames = [];
  const seenKeys = new Set();

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--force-color-profile=srgb'
    ]
  });

  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    timezoneId: 'Asia/Jakarta',
    reducedMotion: 'reduce',
    ignoreHTTPSErrors: true,
    userAgent: MOBILE_UA
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const account = loadAccountConfig();
  let captureUrl = targetUrl;
  let auth = null;

  // Keep screenshots clean and fast by blocking common analytics/tracking pixels.
  await page.route('**/*', (route) => {
    const lower = route.request().url().toLowerCase();
    if (
      /(google-analytics|googletagmanager|doubleclick|fbevents|hotjar|clarity\.ms|posthog|sentry\.io|segment\.io|mixpanel)/.test(
        lower
      )
    ) {
      return route.abort();
    }
    return route.continue();
  });

  try {
    if (account) {
      auth = await performLogin(page, account);
      if (auth.authenticated) {
        captureUrl = account.capture_url || targetUrl;
        log(`Using authenticated start page: ${captureUrl}`);
      } else if (account.public_capture_url) {
        captureUrl = account.public_capture_url;
        log(`Using public start page: ${captureUrl}`);
      }
      if (!auth.authenticated && requireLogin) {
        throw new Error(`Sign-in failed for ${accountId}: ${auth.error || 'unknown error'}`);
      }
    }

    const articleReserve = fallbackUrl ? 1 : 0;
    await capturePageFrames(
      page,
      captureUrl,
      Math.max(1, maxSlides - articleReserve),
      'project',
      frames,
      seenKeys,
      timestamp
    );

    if (fallbackUrl && frames.length < maxSlides) {
      await capturePageFrames(
        page,
        fallbackUrl,
        maxSlides - frames.length,
        'article',
        frames,
        seenKeys,
        timestamp
      );
    }
  } finally {
    await browser.close();
  }

  const meta = {
    project_id: projectId,
    project_name: projectName,
    target_url: targetUrl,
    capture_start_url: captureUrl,
    fallback_url: fallbackUrl || null,
    authenticated: Boolean(auth && auth.authenticated),
    auth: auth
      ? {
          attempted: auth.attempted,
          authenticated: auth.authenticated,
          login_url: auth.login_url,
          final_url: auth.final_url,
          error: auth.error
        }
      : null,
    captured_at: new Date().toISOString(),
    viewport: {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      device_scale_factor: DEVICE_SCALE_FACTOR,
      aspect_ratio: '9:16',
      pixel_size: `${VIEWPORT.width * DEVICE_SCALE_FACTOR}x${VIEWPORT.height * DEVICE_SCALE_FACTOR}`
    },
    frames
  };

  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  log(`Wrote ${frames.length} frame(s) and meta.json to ${outDir}`);
  console.log(JSON.stringify({ ok: true, frames: frames.length, outDir }));
}

main().catch((err) => {
  console.error(`[TikTok Capture] Fatal: ${err.stack || err.message}`);
  process.exit(1);
});
