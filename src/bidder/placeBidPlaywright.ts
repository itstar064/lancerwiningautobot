import { getEstimateTemplate } from "./templates";
import { runExclusive, getSharedContext } from "@/browser/lancersContext";
import { delay } from "@/utils";
import type { ScrapedJobType } from "@/types/job";

const rnd = (a: number, b: number) =>
  a + Math.floor(Math.random() * (b - a + 1));

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

/** "2026年05月11日" — two weeks from now (local). */
export const getCompletionDateJapanese = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}年${mo}月${day}日`;
};

/**
 * Lancers /work/propose_start/{id} flow (2026 UI): description, optional estimate, milestone amount + date, confirm + finish.
 */
export async function placeBidWithSharedContext(
  job: ScrapedJobType,
  bidText: string,
): Promise<boolean> {
  const jobId = job.id || job.url.split("/").pop();
  if (!jobId) {
    console.log("[BID] Missing jobId");
    return false;
  }

  return runExclusive(async () => {
    const context = await getSharedContext();
    const page = await context.newPage();
    const url = `https://www.lancers.jp/work/propose_start/${jobId}?proposeReferer=`;

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
      await delay(rnd(1000, 3000));

      if (page.url().includes("/user/login")) {
        throw new Error("Redirected to login; session may have expired");
      }

      const body = await page.content();
      if (body.includes("既に提案") || body.includes("すでに応募")) {
        console.log(`[BID] Already applied for job ${jobId}`);
        return false;
      }

      // NDA (optional)
      const nda = page.locator("#ProposalIsAgreement");
      if (await nda.isVisible().catch(() => false)) {
        await nda.check({ force: true });
        await delay(rnd(500, 1200));
        console.log("[BID] NDA checkbox checked");
      }

      // Main proposal
      const desc = page.locator('textarea[name="data[Proposal][description]"]');
      if (!(await desc.count())) {
        throw new Error("Proposal description textarea not found");
      }
      await desc.first().fill(bidText);
      await delay(rnd(1000, 2500));

      // 見積 (optional)
      const est = page.locator('textarea[name="data[Proposal][estimate]"]');
      if (await est.count()) {
        await est.first().fill(getEstimateTemplate());
        await delay(rnd(800, 2000));
        console.log("[BID] Filled data[Proposal][estimate]");
      }

      // 契約金額 (税抜) — first step=1000 number in fee/milestone block
      const amount = pickMilestoneAmountJPY(job.price);
      const numIn = page.locator('input[type="number"][step="1000"]').first();
      if (await numIn.isVisible().catch(() => false)) {
        await numIn.fill(String(amount));
        await delay(rnd(800, 1800));
      }

      // 完了予定日 (react-datepicker text input)
      const dateStr = getCompletionDateJapanese();
      const dateInput = page
        .locator(".react-datepicker__input-container input")
        .first();
      if (await dateInput.isVisible().catch(() => false)) {
        await dateInput.fill(dateStr);
        await page.keyboard.press("Tab");
        await delay(rnd(1000, 2000));
        console.log(`[BID] Set completion date: ${dateStr}`);
      }

      // Step 1: 内容を確認する
      const toConfirm = page.locator(
        'input#form_end[type="submit"][value="内容を確認する"]',
      );
      await toConfirm.waitFor({ state: "visible", timeout: 25000 });
      await delay(rnd(1000, 3000));
      await Promise.all([
        page.waitForURL(/propose_confirm/, { timeout: 60000 }),
        toConfirm.click(),
      ]);

      // Step 2: 利用規約に同意して提案する
      const finish = page.locator(
        'input#form_end[type="submit"][value="利用規約に同意して提案する"]',
      );
      await finish.waitFor({ state: "visible", timeout: 30000 });
      await delay(rnd(1000, 3000));
      await finish.click();
      await page
        .waitForLoadState("networkidle", { timeout: 60000 })
        .catch(() => undefined);

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
      console.error(`[ERROR] placeBid: ${(e as Error).message}`);
      return false;
    } finally {
      await page.close().catch(() => undefined);
    }
  });
}
