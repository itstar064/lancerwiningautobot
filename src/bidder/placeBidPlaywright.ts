import { getEstimateTemplate } from "./templates";
import { runExclusive, getSharedContext } from "@/browser/lancersContext";
import { delay } from "@/utils";
import type { ScrapedJobType } from "@/types/job";
import type { Page } from "playwright";
import config from "@/config";
import { getMaxListingBudgetJPY } from "./filters";

const rnd = (a: number, b: number) =>
  a + Math.floor(Math.random() * (b - a + 1));

const bidPause = () => {
  if (config.BID_BROWSER_DELAY_MAX_MS <= 0) {
    return 0;
  }
  return rnd(config.BID_BROWSER_DELAY_MIN_MS, config.BID_BROWSER_DELAY_MAX_MS);
};

const maybeDelayBidPause = async () => {
  const ms = bidPause();
  if (ms > 0) await delay(ms);
};

/** `YYYY年MM月DD日` (optional time after day ignored). */
export const formatDateJapanese = (d: Date): string => {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}年${mo}月${day}日`;
};

/** Parse Lancers-style date from detail / schedule text. */
export const parseJapaneseLancersDate = (raw: string): Date | null => {
  const s = raw.replace(/\s+/g, " ").trim();
  const m = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  const dt = new Date(y, mo, day, 12, 0, 0, 0);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo ||
    dt.getDate() !== day
  ) {
    return null;
  }
  return dt;
};

const addDays = (base: Date, n: number): Date => {
  const out = new Date(base.getTime());
  out.setHours(12, 0, 0, 0);
  out.setDate(out.getDate() + n);
  return out;
};

/** 依頼詳細: `.p-work-detail-schedule__item` with 希望納期, or definition list fallback. */
const extractClientPreferredDeliveryDateFromPage = async (
  page: Page,
): Promise<Date | null> => {
  const items = page.locator(".p-work-detail-schedule__item");
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const title =
      (await item
        .locator(".p-work-detail-schedule__item__title")
        .textContent()
        .catch(() => null)) || "";
    if (!title.includes("希望納期")) continue;
    const text =
      (await item
        .locator(".p-work-detail-schedule__text")
        .first()
        .textContent()
        .catch(() => null)) || "";
    const d = parseJapaneseLancersDate(text);
    if (d) return d;
  }

  const dd = page
    .locator(
      "dt.c-definition-list__term, dt.p-work-detail-lancer__postscript-term",
    )
    .filter({ hasText: /希望納期/ })
    .locator("xpath=./following-sibling::dd[1]");
  if ((await dd.count()) > 0) {
    const text = (await dd.first().innerText().catch(() => "")) || "";
    const firstLine = text.split("\n")[0]?.trim() || text;
    const d = parseJapaneseLancersDate(firstLine);
    if (d) return d;
  }
  return null;
};

/**
 * 完了予定日 for propose form:
 * - If client 希望納期 on detail page: that date + random 1–10 days.
 * - Else by listing budget high-end: &lt;100k → 3–10d; 100k–300k → 10–30d; &gt;300k → 30–60d from today.
 * - If budget unparseable and no client date: `BID_COMPLETION_DAYS` from env.
 */
export const computeCompletionDateJapanese = (
  job: ScrapedJobType,
  clientPreferred: Date | null,
): string => {
  if (clientPreferred) {
    const plus = rnd(1, 10);
    const d = addDays(clientPreferred, plus);
    console.log(
      `[BID] 完了予定日: 希望納期+${plus}日 → ${formatDateJapanese(d)}`,
    );
    return formatDateJapanese(d);
  }

  const maxB = getMaxListingBudgetJPY(job.price);
  let days: number;
  if (maxB === null) {
    days = Math.max(1, config.BID_COMPLETION_DAYS);
    console.log(
      `[BID] 完了予定日: no希望納期 & budget unparseable → fallback ${days}d (BID_COMPLETION_DAYS)`,
    );
  } else if (maxB < 100_000) {
    days = rnd(3, 10);
    console.log(`[BID] 完了予定日: budget<100k → today+${days}d`);
  } else if (maxB <= 300_000) {
    days = rnd(10, 30);
    console.log(`[BID] 完了予定日: 100k–300k → today+${days}d`);
  } else {
    days = rnd(30, 60);
    console.log(`[BID] 完了予定日: budget>300k → today+${days}d (~1–2mo)`);
  }
  return formatDateJapanese(addDays(new Date(), days));
};

/** Next milestone amount (JPY) from scraped price; step 1000, min 1000. */
export const pickMilestoneAmountJPY = (
  priceLine: string,
  fallback = 10000,
): number => {
  const nums = (priceLine || "").match(/\d{1,3}(?:,\d{3})+|\d+/g);
  if (!nums || nums.length === 0) return fallback;
  const n = parseInt(nums[0].replace(/,/g, ""), 10);
  if (Number.isNaN(n) || n < 0) return fallback;
  const stepped = Math.round(n / 1000) * 1000;
  return Math.max(1000, stepped);
};

/** Legacy: fixed offset from today (env `BID_COMPLETION_DAYS`). */
export const getCompletionDateJapanese = (daysFromToday?: number): string => {
  const days = daysFromToday ?? config.BID_COMPLETION_DAYS;
  return formatDateJapanese(addDays(new Date(), Math.max(1, days)));
};

/** Prefer numeric id from /work/detail/12345, then job.id, then last path segment. */
const resolveLancersJobId = (job: ScrapedJobType): string | null => {
  const fromDetail = job.url?.match(/\/work\/detail\/(\d+)/)?.[1];
  if (fromDetail) return fromDetail;
  const raw =
    (job.id != null && String(job.id)) ||
    job.url?.split("?")[0]?.split("/").filter(Boolean).pop() ||
    "";
  if (/^\d+$/.test(String(raw))) return String(raw);
  const fromAny = String(raw).match(/(\d{4,})/);
  return fromAny ? fromAny[1] : null;
};

/** Lancers can hide validation errors while disabling submit; long API text also trips limits. */
const BID_PROPOSAL_MAX_LENGTH = 5000;
const PROPOSE_FORM_ACTION_TIMEOUT_MS = 45_000;
const PROPOSE_NAV_TIMEOUT_MS = 60_000;

const truncateBidIfNeeded = (text: string): string => {
  if (text.length <= BID_PROPOSAL_MAX_LENGTH) return text;
  const t = text.slice(0, BID_PROPOSAL_MAX_LENGTH - 30) + "\n\n(以降省略しました)";
  console.log(
    `[BID] Truncated proposal to ${BID_PROPOSAL_MAX_LENGTH} chars (Lancers limit / validation)`,
  );
  return t;
};

/**
 * 内容を確認 / 最終提案: Lancers may use <button> with text, not input[value=...].
 */
const findPrimarySubmit = (
  page: Page,
  kind: "confirm" | "finish",
) => {
  if (kind === "confirm") {
    return page
      .getByRole("button", { name: /内容を確認/ })
      .or(page.locator('input[type="submit"][value="内容を確認する"]'))
      .or(
        page.locator(
          'button[type="submit"]',
          { hasText: "内容を確認" },
        ),
      );
  }
  return page
    .getByRole("button", { name: /利用規約に同意/ })
    .or(
      page.locator(
        'input[type="submit"][value="利用規約に同意して提案する"]',
      ),
    )
    .or(
      page.locator("button[type=submit]", {
        hasText: "利用規約に同意",
      }),
    );
};

const scrollProposeFormFooter = async (page: Page) => {
  await page
    .evaluate(() => {
      const form = document.getElementById("ProposalProposeForm");
      if (form) {
        form.scrollIntoView({ block: "end" });
      }
      window.scrollTo(0, document.body.scrollHeight);
    })
    .catch(() => undefined);
  if (config.BID_BROWSER_DELAY_MAX_MS > 0) {
    await delay(100);
  }
};

/**
 * 提案文欄: DOM differs (id vs name, lazy paint). Primary OR-wait, then fallbacks.
 */
const fillProposalDescription = async (page: Page, bidText: string) => {
  const primary = page.locator(
    [
      "textarea#ProposalDescription",
      'textarea[name="data[Proposal][description]"]',
      'textarea[name="data[Proposal][message]"]',
    ].join(", "),
  ).first();
  const primaryOk = await primary
    .waitFor({ state: "visible", timeout: 18_000 })
    .then(() => true)
    .catch(() => false);
  if (primaryOk) {
    await primary.fill(bidText);
    console.log("[BID] Filled description (primary selector)");
    return;
  }

  const secondary = page.locator(
    "form#ProposalProposeForm textarea, form[action*='propose'] textarea, textarea.c-form__element",
  ).first();
  if (
    await secondary
      .waitFor({ state: "visible", timeout: 6_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await secondary.fill(bidText);
    console.log("[BID] Filled description (form/secondary selector)");
    return;
  }

  const all = page.locator(
    "main textarea, [role=main] textarea, .l-page__main textarea, form textarea",
  );
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const box = all.nth(i);
    if (!(await box.isVisible().catch(() => false))) continue;
    const name = (await box.getAttribute("name")) || "";
    const id = (await box.getAttribute("id")) || "";
    if (name.includes("estimate") || id.toLowerCase().includes("estimate")) {
      continue;
    }
    await box.fill(bidText);
    console.log(
      `[BID] Filled description via visible textarea[${i}] name=${name} id=${id}`,
    );
    return;
  }

  const ce = page.locator(
    "[contenteditable='true'][data-placeholder], .ck-editor__editable, [contenteditable='true']",
  ).first();
  if (await ce.isVisible().catch(() => false)) {
    await ce.click();
    await page.keyboard.insertText(bidText);
    console.log("[BID] Filled description via contenteditable");
    return;
  }

  throw new Error("Proposal description textarea not found (see selectors / page HTML)");
};

/**
 * Open detail → read 希望納期 → click 提案する. Does not wait for full `load` / `networkidle`.
 */
const gotoProposeFormViaDetailPage = async (
  page: Page,
  jobId: string,
): Promise<Date | null> => {
  const detailUrl = `https://www.lancers.jp/work/detail/${jobId}`;
  console.log(`[BID] Open work detail: ${detailUrl}`);
  await page.goto(detailUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await maybeDelayBidPause();

  if (page.url().includes("/user/login")) {
    throw new Error("Redirected to login; session may have expired");
  }

  const body = await page.content();
  if (body.includes("既に提案") || body.includes("すでに応募")) {
    throw new Error("ALREADY_APPLIED");
  }

  const clientPref = await extractClientPreferredDeliveryDateFromPage(page);
  if (clientPref) {
    console.log(`[BID] Parsed client 希望納期: ${formatDateJapanese(clientPref)}`);
  }

  const proposeLink = page
    .locator('a.p-work-detail__righter-button[href*="/work/propose_start/"]')
    .first();
  await proposeLink.waitFor({ state: "visible", timeout: 20_000 });
  const href = await proposeLink.getAttribute("href");
  console.log(`[BID] Click 提案する → ${href || ""}`);
  await proposeLink.scrollIntoViewIfNeeded();
  await maybeDelayBidPause();
  await Promise.all([
    page.waitForURL(/\/work\/propose_start\//, { timeout: PROPOSE_NAV_TIMEOUT_MS }),
    proposeLink.click(),
  ]);
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
  await maybeDelayBidPause();
  return clientPref;
};

/**
 * Lancers: detail page → 提案する → propose form. Then fill, confirm, submit.
 */
export async function placeBidWithSharedContext(
  job: ScrapedJobType,
  bidText: string,
): Promise<boolean> {
  const jobId = resolveLancersJobId(job);
  if (!jobId) {
    console.log("[BID] Missing jobId");
    return false;
  }

  return runExclusive(async () => {
    const context = await getSharedContext();
    const page = await context.newPage();

    try {
      const safeBid = truncateBidIfNeeded(bidText);

      const clientPreferred = await gotoProposeFormViaDetailPage(page, jobId);

      if (page.url().includes("/user/login")) {
        throw new Error("Redirected to login; session may have expired");
      }

      // NDA (optional)
      const nda = page.locator("#ProposalIsAgreement");
      if (await nda.isVisible().catch(() => false)) {
        await nda.check({ force: true });
        await maybeDelayBidPause();
        console.log("[BID] NDA checkbox checked");
      }

      await fillProposalDescription(page, safeBid);
      await maybeDelayBidPause();

      // 見積 (optional)
      const est = page.locator('textarea[name="data[Proposal][estimate]"]');
      if (await est.count()) {
        await est.first().fill(getEstimateTemplate());
        await maybeDelayBidPause();
        console.log("[BID] Filled data[Proposal][estimate]");
      }

      // 契約金額 (税抜) — first step=1000 number in fee/milestone block
      const amount = pickMilestoneAmountJPY(job.price);
      const numIn = page.locator('input[type="number"][step="1000"]').first();
      if (await numIn.isVisible().catch(() => false)) {
        await numIn.fill(String(amount));
        await maybeDelayBidPause();
      }

      // 完了予定日 (react-datepicker text input)
      const dateStr = computeCompletionDateJapanese(job, clientPreferred);
      const dateInput = page
        .locator(".react-datepicker__input-container input")
        .first();
      if (await dateInput.isVisible().catch(() => false)) {
        await dateInput.fill(dateStr);
        await page.keyboard.press("Tab");
        await maybeDelayBidPause();
        console.log(`[BID] Set completion date: ${dateStr}`);
      }

      // Step 1: 内容を確認 (button or input; footer may be off-screen)
      await scrollProposeFormFooter(page);
      const toConfirm = findPrimarySubmit(page, "confirm").first();
      await toConfirm.waitFor({
        state: "visible",
        timeout: PROPOSE_FORM_ACTION_TIMEOUT_MS,
      });
      await toConfirm.scrollIntoViewIfNeeded();
      await maybeDelayBidPause();
      if (
        (await toConfirm.getAttribute("disabled")) !== null ||
        (await toConfirm.isDisabled().catch(() => false))
      ) {
        const errText = await page
          .locator(".c-form__error, .c-text--error, [class*='error']")
          .first()
          .textContent()
          .catch(() => null);
        throw new Error(
          `内容を確認 is disabled. Check required fields. Page hint: ${errText || "(no error node)"}`,
        );
      }
      await Promise.all([
        page.waitForURL(/propose_confirm/, { timeout: PROPOSE_NAV_TIMEOUT_MS }),
        toConfirm.click(),
      ]);

      // Step 2: 利用規約に同意して提案する
      await scrollProposeFormFooter(page);
      const finish = findPrimarySubmit(page, "finish").first();
      await finish.waitFor({
        state: "visible",
        timeout: PROPOSE_FORM_ACTION_TIMEOUT_MS,
      });
      await finish.scrollIntoViewIfNeeded();
      await maybeDelayBidPause();
      await finish.click();
      await Promise.race([
        page.waitForURL(/propose_finish|mypage/, { timeout: 25_000 }),
        page.waitForLoadState("domcontentloaded", { timeout: 12_000 }),
      ]).catch(() => undefined);

      const endUrl = page.url();
      if (endUrl.includes("propose_finish") || endUrl.includes("mypage")) {
        console.log(`[BID] Submitted bid for job ${jobId}`);
        return true;
      }
      const html = await page.content();
      if (/提案が完了|応募が完了|送信しました/.test(html)) {
        return true;
      }
      console.log(`[BID] Ambiguous end state; url=${endUrl}`);
      return true;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "ALREADY_APPLIED") {
        console.log(`[BID] Already applied for job ${jobId}`);
        return false;
      }
      console.error(`[ERROR] placeBid: ${msg}`);
      return false;
    } finally {
      await page.close().catch(() => undefined);
    }
  });
}
