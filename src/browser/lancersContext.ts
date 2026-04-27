import * as fs from "fs";
import config from "@/config";
import { chromium, type BrowserContext, type Page } from "playwright";

/** Third-party scripts to abort when `LANCERS_BLOCK_STATIC_ASSETS` is on. */
const TRACKER_SCRIPT_RE =
  /googletagmanager\.com|google-analytics\.com|\/gtag\/js|googleadservices\.com|doubleclick\.net|facebook\.net\/|hotjar\.com|clarity\.ms|linkedin\.com\/px|segment\.(?:com|io)|fullstory\.com|browser-intake-datadog|sentry\.io/i;

const installOptionalAssetBlocking = async (ctx: BrowserContext) => {
  if (!config.LANCERS_BLOCK_STATIC_ASSETS) return;
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    const type = req.resourceType();
    if (
      type === "stylesheet" ||
      type === "font" ||
      type === "image" ||
      type === "media"
    ) {
      await route.abort();
      return;
    }
    if (type === "script" && TRACKER_SCRIPT_RE.test(req.url())) {
      await route.abort();
      return;
    }
    await route.continue();
  });
  console.log(
    "[SCRAPER] LANCERS_BLOCK_STATIC_ASSETS: blocking stylesheet/font/image/media + tracker scripts.",
  );
};

/** Single persistent Chromium context (profile on disk). */
let context: BrowserContext | null = null;
let lastCookieHeader: string | null = null;
let lockChain = Promise.resolve();

export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = lockChain.then(() => fn());
  lockChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const performLogin = async (page: Page) => {
  await page.goto("https://www.lancers.jp/user/login", {
    waitUntil: "domcontentloaded",
  });

  if (page.url().includes("/mypage")) {
    return;
  }

  await page.waitForSelector("#login_form, form#login_form", { timeout: 20000 });
  await page.waitForSelector("#UserEmail", { timeout: 15000 });
  await page.waitForSelector("#UserPassword", { timeout: 15000 });
  await page.waitForSelector("#form_submit", { timeout: 15000 });

  await page.fill("#UserEmail", "");
  await page.type("#UserEmail", config.EMAIL, { delay: 25 });
  await page.fill("#UserPassword", "");
  await page.type("#UserPassword", config.PASSWORD, { delay: 25 });

  const navigationPromise = page
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 45000 })
    .catch(() => undefined);
  await page.click("#form_submit");
  try {
    await navigationPromise;
  } catch {
    // ignore
  }

  if (page.url().includes("/verify_code")) {
    console.log(
      "[SCRAPER] Verification required (/verify_code). Complete it in the browser; waiting for /mypage...",
    );
    await page.waitForURL("**/mypage**", { timeout: 0 });
  } else {
    await page.waitForURL("**/mypage**", { timeout: 60000 });
  }
};

const needsLogin = async (page: Page): Promise<boolean> => {
  const url = page.url();
  if (url.includes("/user/login")) return true;
  const email = page.locator("#UserEmail, input#UserEmail");
  if (await email.first().isVisible().catch(() => false)) return true;
  return false;
};

/** Open mypage; if session from disk is valid, skip password login. */
const ensureSessionOrLogin = async (page: Page) => {
  await page.goto("https://www.lancers.jp/mypage", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });

  if (await needsLogin(page)) {
    console.log("[SCRAPER] Persistent profile: session missing or expired → logging in…");
    await performLogin(page);
  } else {
    console.log(
      `[SCRAPER] Persistent profile: reusing session (${config.LANCERS_BROWSER_USER_DATA_DIR})`,
    );
  }
};

const ensureContext = async () => {
  if (!context) {
    const userDataDir = config.LANCERS_BROWSER_USER_DATA_DIR;
    fs.mkdirSync(userDataDir, { recursive: true });
    console.log(
      `[SCRAPER] Launching Chromium persistent context → ${userDataDir}`,
    );
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: config.LANCERS_HEADLESS,
      locale: "ja-JP",
      viewport: { width: 1280, height: 800 },
    });
    await installOptionalAssetBlocking(context);
    const page = await context.newPage();
    await ensureSessionOrLogin(page);
    await page.close();
  }
};

/** Close context and reopen; same profile dir reloads cookies from disk, then re-login if needed. */
export const resetLancersContext = () =>
  runExclusive(async () => {
    if (context) {
      await context.close().catch(() => undefined);
      context = null;
    }
    lastCookieHeader = null;
    await ensureContext();
    return getCookieHeaderString();
  });

export const getSharedContext = async (): Promise<BrowserContext> => {
  await ensureContext();
  return context!;
};

const getCookieHeaderString = async () => {
  const ctx = context!;
  const cookies = await ctx.cookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
};

/**
 * Return Cookie header for authenticated Axios fetches. Reuses one logged-in context.
 */
export const getAuthCookieHeader = () =>
  runExclusive(async () => {
    await ensureContext();
    lastCookieHeader = await getCookieHeaderString();
    return lastCookieHeader;
  });

export { lastCookieHeader };
