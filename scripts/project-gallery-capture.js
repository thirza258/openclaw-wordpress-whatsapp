#!/usr/bin/env node
'use strict';

/**
 * Product Hunt / directory gallery capture with optional account sign-in.
 *
 * Runs inside the Playwright Docker image. When a login config is supplied it
 * signs in through the real site UI first, then captures the *inside* app
 * (workspace, dashboard, chat, editor, ...) instead of the public landing page.
 *
 * Produces the 3-image gallery used by project-launch-kit.js:
 *   1. desktop  1280x800
 *   2. feature  1440x900  (optional deeper view / feature page)
 *   3. mobile    390x844 (2x DPR)
 *
 * Usage:
 *   node project-gallery-capture.js \
 *     --url https://example.com \
 *     --capture-url https://example.com/app \
 *     --out-dir /out \
 *     --project-id example \
 *     --project-name "Example App" \
 *     --timestamp 1700000000000 \
 *     [--login-config /opt/accounts.json --account example] \
 *     [--require-login]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const VIEWS = [
  {
    id: 'desktop',
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    isMobile: false,
    label: 'Desktop Hero Showcase (Product Hunt Image 1 / Web)'
  },
  {
    id: 'feature',
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    isMobile: false,
    label: 'Workspace & Feature View (Product Hunt Image 2 / Gallery)'
  },
  {
    id: 'mobile',
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    isMobile: true,
    label: 'Mobile Responsive View (Product Hunt Image 3 / Instagram & TikTok)'
  }
];

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

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
const captureUrlArg = typeof args['capture-url'] === 'string' ? args['capture-url'] : '';
const featureUrlArg = typeof args['feature-url'] === 'string' ? args['feature-url'] : '';
const outDir = typeof args['out-dir'] === 'string' ? args['out-dir'] : '/out';
const projectId = typeof args['project-id'] === 'string' ? args['project-id'] : 'project';
const projectName = typeof args['project-name'] === 'string' ? args['project-name'] : 'Project';
const timestamp = typeof args.timestamp === 'string' ? args.timestamp : String(Date.now());
const loginConfigPath = typeof args['login-config'] === 'string' ? args['login-config'] : '';
const accountId = typeof args.account === 'string' ? args.account : projectId;
const requireLogin = Boolean(args['require-login']);

function log(message) {
  console.log(`[Gallery Capture] ${message}`);
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

      // Accessibility skip-links are usually visually hidden, but some
      // themes render them as a solid overlay across the header.
      for (const el of document.querySelectorAll('a, button')) {
        const text = (el.innerText || '').trim().toLowerCase();
        if (/^skip (to|navigation to) /.test(text) && text.length < 60) {
          el.style.setProperty('display', 'none', 'important');
        }
      }

      // Unnamed fixed consent bars along the bottom edge.
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
    // Non-fatal.
  }
}

async function waitForPageReady(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 });
  } catch (err) {
    // SPAs with polling never reach networkidle; a fixed pause is enough.
  }
  await page.waitForTimeout(2200);
  try {
    await page.evaluate(() => document.fonts && document.fonts.ready);
  } catch (err) {}
  await page.waitForTimeout(500);
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
        await sleepInPage(90);
      }
      window.scrollTo(0, 0);
      await sleepInPage(250);
    });
  } catch (err) {}
  await page.waitForTimeout(600);
}

async function scrollToFeatureSection(page) {
  try {
    const maxScroll = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      return (
        Math.max(
          body ? body.scrollHeight : 0,
          body ? body.offsetHeight : 0,
          doc ? doc.scrollHeight : 0,
          doc ? doc.offsetHeight : 0
        ) - window.innerHeight
      );
    });

    // Chat apps and dashboards often use an inner scroll container instead.
    if (maxScroll < 220) {
      const scrolled = await page.evaluate(() => {
        let best = null;
        for (const el of document.querySelectorAll('body *')) {
          const style = window.getComputedStyle(el);
          if (!/(auto|scroll)/.test(style.overflowY)) continue;
          if (el.scrollHeight <= el.clientHeight + 220) continue;
          if (el.clientHeight < Math.min(300, window.innerHeight * 0.4)) continue;
          const area = el.clientHeight * el.clientWidth;
          if (!best || area > best.area) best = { el, area };
        }
        if (!best) return false;
        const target = best.el.scrollHeight - best.el.clientHeight;
        best.el.scrollTop = Math.round(target * 0.45);
        return true;
      });
      if (scrolled) {
        await page.waitForTimeout(900);
        return;
      }
    }

    if (maxScroll > 220) {
      await page.evaluate((top) => window.scrollTo({ top, left: 0, behavior: 'instant' }), Math.round(maxScroll * 0.42));
      await page.waitForTimeout(900);
    }
  } catch (err) {}
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

async function runSteps(page, steps, phaseName) {
  for (const step of steps || []) {
    if (!step.click) continue;
    try {
      const target = page.locator(step.click).first();
      await target.waitFor({ state: 'visible', timeout: step.timeout_ms || 10000 });
      await target.click();
      await page.waitForTimeout(step.wait_ms || 800);
      log(`${phaseName}: clicked ${step.click}`);
    } catch (err) {
      // Tolerant: a step meant for one viewport may be hidden in another.
      log(`${phaseName}: skipped ${step.click} (${err.message.split('\n')[0]})`);
    }
  }
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
    log(`Signing in as the OpenClaw account for ${accountId}...`);
    await page.goto(account.login_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForPageReady(page);
    await dismissCookieAndConsentBanners(page);

    await runSteps(page, account.pre_steps, 'login pre-step');

    for (const [selector, value] of Object.entries(account.fields)) {
      const field = page.locator(selector).first();
      await field.waitFor({ state: 'visible', timeout: 15000 });
      await field.fill(value);
      await page.waitForTimeout(100);
    }

    const submit = page.locator(account.submit).first();
    await submit.waitFor({ state: 'visible', timeout: 15000 });
    await submit.click();
    await page.waitForTimeout(1800);
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
      await runSteps(page, account.post_steps, 'post-login step');
    } else {
      log(`Sign-in did not complete${info.error ? ` (${info.error})` : ''}.`);
    }
  } catch (err) {
    info.final_url = page.url();
    info.error = err.message;
    log(`Sign-in failed (${err.message}).`);
  }

  return info;
}

async function preparePage(page, url) {
  log(`Opening ${url}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (err) {
    if (!/interrupted by another navigation/i.test(err.message)) {
      throw err;
    }
    await page.waitForTimeout(1500);
  }
  await waitForPageReady(page);
  await dismissCookieAndConsentBanners(page);
  await warmUpLazyContent(page);

  // warmUpLazyContent returns to the top; restore an in-page anchor
  // (e.g. #start, #dashboard, #generator) so the app view is captured.
  const hash = (() => {
    try { return new URL(page.url()).hash; } catch (e) { return ''; }
  })();
  if (hash) {
    try {
      await page.evaluate((h) => {
        const el = document.getElementById(decodeURIComponent(h.slice(1)));
        if (!el) return;
        // Keep the anchored section clear of a sticky/fixed site header.
        const header = document.querySelector('header') || document.querySelector('nav');
        const headerHeight = header
          ? Math.min(header.getBoundingClientRect().height || 0, 120)
          : 0;
        el.style.scrollMarginTop = `${headerHeight + 10}px`;
        el.scrollIntoView({ block: 'start' });
      }, hash);
      await page.waitForTimeout(800);
    } catch (err) {}
  }

  return page.url();
}

async function shoot(page, view, filename) {
  const filePath = path.join(outDir, filename);
  await page.screenshot({
    path: filePath,
    animations: 'disabled',
    caret: 'hide'
  });
  log(`Captured ${view.id} view: ${filename}`);
  return filePath;
}

async function main() {
  if (!targetUrl) {
    throw new Error('Missing required --url argument.');
  }

  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--force-color-profile=srgb'
    ]
  });

  const blockTracking = async (context) => {
    await context.route('**/*', (route) => {
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
  };

  const account = loadAccountConfig();
  let auth = null;
  let startUrl = captureUrlArg || targetUrl;
  let featureUrl = featureUrlArg || '';

  const desktopContext = await browser.newContext({
    viewport: { width: VIEWS[0].width, height: VIEWS[0].height },
    deviceScaleFactor: VIEWS[0].deviceScaleFactor,
    locale: 'en-US',
    timezoneId: 'Asia/Jakarta',
    reducedMotion: 'reduce',
    ignoreHTTPSErrors: true
  });
  await blockTracking(desktopContext);
  const page = await desktopContext.newPage();
  page.setDefaultTimeout(30000);

  try {
    if (account) {
      auth = await performLogin(page, account);

      if (auth.authenticated) {
        startUrl = captureUrlArg || account.capture_url || targetUrl;
        featureUrl = featureUrlArg || account.feature_url || '';
        log(`Using signed-in start page: ${startUrl}`);
      } else if (requireLogin) {
        throw new Error(`Sign-in failed for ${accountId}: ${auth.error || 'unknown error'}`);
      } else {
        // Prefer a guest-accessible app page over the marketing landing page.
        // A protected URL would redirect to login, so only use it when the
        // project explicitly marks it as public.
        startUrl = account.public_capture_url || targetUrl;
        featureUrl = '';
        log(`Falling back to the public app page: ${startUrl}`);
      }
    }

    const baseUrlForLoginCheck = startUrl;

    // Build the filename map up front so view 2 can share view 1's navigation.
    const filenames = {};
    for (const view of VIEWS) {
      filenames[view.id] = `${projectId}_${view.id}_${timestamp}.png`;
    }

    const views = [];

    // 1) Desktop
    let view = VIEWS[0];
    await page.setViewportSize({ width: view.width, height: view.height });
    let finalUrl = await preparePage(page, startUrl);
    if (auth && auth.authenticated && /\/(login|signin|sign-in)(\/|$|\?)/i.test(new URL(finalUrl).pathname)) {
      log('Authenticated start page redirected to a login screen; using the public landing page instead.');
      startUrl = targetUrl;
      featureUrl = '';
      finalUrl = await preparePage(page, startUrl);
      auth.authenticated = false;
    }
    views.push({
      id: view.id,
      label: view.label,
      filename: filenames[view.id],
      url: finalUrl,
      width: view.width,
      height: view.height,
      device_scale_factor: view.deviceScaleFactor
    });
    await shoot(page, view, filenames[view.id]);

    // 2) Workspace / feature view
    view = VIEWS[1];
    await page.setViewportSize({ width: view.width, height: view.height });
    if (featureUrl && featureUrl !== startUrl) {
      const featureFinalUrl = await preparePage(page, featureUrl);
      views.push({
        id: view.id,
        label: view.label,
        filename: filenames[view.id],
        url: featureFinalUrl,
        width: view.width,
        height: view.height,
        device_scale_factor: view.deviceScaleFactor
      });
    } else {
      // A hash means we deliberately anchored to an in-app section (#start,
      // #dashboard, #generator, ...). Scrolling away from it would land on
      // marketing content below the workspace, so keep the anchored view.
      const currentHash = (() => {
        try { return new URL(page.url()).hash; } catch (e) { return ''; }
      })();
      if (!currentHash) {
        await scrollToFeatureSection(page);
      }
      views.push({
        id: view.id,
        label: view.label,
        filename: filenames[view.id],
        url: page.url(),
        width: view.width,
        height: view.height,
        device_scale_factor: view.deviceScaleFactor
      });
    }
    await shoot(page, view, filenames[view.id]);

    // 3) Mobile, reusing the signed-in storage state (cookies + localStorage).
    const storageState = await desktopContext.storageState();
    const mobileContext = await browser.newContext({
      viewport: { width: VIEWS[2].width, height: VIEWS[2].height },
      deviceScaleFactor: VIEWS[2].deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
      locale: 'en-US',
      timezoneId: 'Asia/Jakarta',
      reducedMotion: 'reduce',
      ignoreHTTPSErrors: true,
      userAgent: MOBILE_UA,
      storageState
    });
    await blockTracking(mobileContext);
    const mobilePage = await mobileContext.newPage();
    mobilePage.setDefaultTimeout(30000);
    try {
      view = VIEWS[2];
      const mobileFinalUrl = await preparePage(mobilePage, startUrl);
      views.push({
        id: view.id,
        label: view.label,
        filename: filenames[view.id],
        url: mobileFinalUrl,
        width: view.width,
        height: view.height,
        device_scale_factor: view.deviceScaleFactor
      });
      await shoot(mobilePage, view, filenames[view.id]);
    } finally {
      await mobileContext.close();
    }

    const meta = {
      project_id: projectId,
      project_name: projectName,
      target_url: targetUrl,
      capture_start_url: startUrl,
      feature_url: featureUrl || null,
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
      timestamp,
      views
    };

    fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
    log(`Wrote 3 views and meta.json to ${outDir}`);
    console.log(JSON.stringify({ ok: true, authenticated: meta.authenticated, outDir }));
  } finally {
    await desktopContext.close().catch(() => {});
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`[Gallery Capture] Fatal: ${err.stack || err.message}`);
  process.exit(1);
});
