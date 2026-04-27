import config from "@/config";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

let browser: Browser | null = null;
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
    .waitForNavigation({ waitUntil: "networkidle", timeout: 45000 })
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

const ensureContext = async () => {
  if (!browser) {
    browser = await chromium.launch({
      headless: false,
    });
  }
  if (!context) {
    context = await browser.newContext();
    const page = await context.newPage();
    console.log("[SCRAPER] Logging in (shared Playwright context)…");
    await performLogin(page);
    await page.close();
  }
};

/** Reset context (e.g. cookie expired) and log in again. */
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
