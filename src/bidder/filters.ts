import type { ScrapedJobType } from "@/types/job";

/** New-job Telegram gate: `any` = notify every new job; `set` = notify only if listing budget fits [min,max]. */
export type JobNotifyPriceMode = "any" | "set";

/** True if listing scraped a non-empty 報酬 line (non-whitespace). */
export const listingPriceIsSet = (job: ScrapedJobType): boolean => {
  const p = (job.price || "").replace(/\s/g, "");
  return p.length > 0;
};

/**
 * Listing budget (high end from card text) within [minJpy, maxJpy] inclusive.
 * Uses `getMaxListingBudgetJPY`; unparseable → false.
 */
export const listingBudgetWithinRange = (
  job: ScrapedJobType,
  minJpy: number,
  maxJpy: number,
): boolean => getBidSkipReason(job, minJpy, maxJpy) === null;

/** Whether a new job should trigger Telegram (and then bid attempt). */
export const jobPassesPopupPriceFilter = (
  job: ScrapedJobType,
  mode: JobNotifyPriceMode,
  minJpy: number,
  maxJpy: number,
): boolean => {
  if (mode === "any") return true;
  return listingBudgetWithinRange(job, minJpy, maxJpy);
};

/** `JOB_NOTIFY_PRICE`: `any` | `set` (aliases: budget, required, yes, 1, true). */
export const parseJobNotifyPriceMode = (raw: string | undefined): JobNotifyPriceMode => {
  const v = (raw || "any").toLowerCase().trim();
  if (
    v === "set" ||
    v === "budget" ||
    v === "required" ||
    v === "yes" ||
    v === "1" ||
    v === "true"
  ) {
    return "set";
  }
  return "any";
};

/** Parse first integer from strings like "12名が応募" or "5" */
export const parseProposalCount = (s: string): number => {
  const m = (s || "").match(/(\d+)/);
  if (!m) return 0;
  return parseInt(m[1], 10);
};

const parsePriceTokenJPY = (token: string): number | null => {
  const s = token.replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
};

/**
 * Extract an upper-bound budget from listing price text.
 * Examples:
 * - "50,000~120,000円" => 120000
 * - "20万円" => 200000
 * - "2.5万円 ~ 4万円" => 40000
 */
export const getMaxListingBudgetJPY = (priceText: string): number | null => {
  const values: number[] = [];
  const compact = (priceText || "").replace(/\s+/g, " ").trim();
  if (!compact) return null;

  const manRegex = /(\d+(?:\.\d+)?)\s*万/g;
  for (const m of compact.matchAll(manRegex)) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) {
      values.push(Math.round(n * 10_000));
    }
  }

  const numericRegex = /(\d[\d,]*)/g;
  for (const m of compact.matchAll(numericRegex)) {
    const tokenVal = parsePriceTokenJPY(m[1]);
    if (tokenVal !== null) {
      values.push(tokenVal);
    }
  }

  if (values.length === 0) return null;
  return Math.max(...values);
};

/**
 * Reason auto-bid is skipped, or `null` if listing max budget is in [minJpy, maxJpy].
 * Compares parsed listing **high-end** budget to env `BID_MIN_BUDGET_JPY` / `BID_MAX_BUDGET_JPY`.
 */
export const getBidSkipReason = (
  job: ScrapedJobType,
  minJpy: number,
  maxJpy: number,
): string | null => {
  const maxVal = getMaxListingBudgetJPY(job.price);
  if (maxVal === null) {
    return `budget_unparseable(cannot_verify_range_${minJpy}_${maxJpy}_jpy)`;
  }
  if (maxVal < minJpy) {
    return `budget_below_min(listing_max_jpy=${maxVal}, min=${minJpy})`;
  }
  if (maxVal > maxJpy) {
    return `budget_over_max(listing_max_jpy=${maxVal}, max=${maxJpy})`;
  }
  return null;
};

/** True if auto-bid allowed for this listing under the configured [min, max] JPY window. */
export const shouldBid = (
  job: ScrapedJobType,
  minJpy: number,
  maxJpy: number,
): boolean => getBidSkipReason(job, minJpy, maxJpy) === null;
