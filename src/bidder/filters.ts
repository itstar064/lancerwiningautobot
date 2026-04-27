import type { ScrapedJobType } from "@/types/job";

/** New-job popup / bid path filter from `JOB_NOTIFY_PRICE`: any | set (0–200,000 円範囲). */
export type JobNotifyPriceMode = "any" | "set";

/** Upper bound of listing budget (JPY) we treat as 0~200,000 円案件 (matches `shouldBid` cap). */
export const BID_MAX_BUDGET_JPY = 200_000;

/** True if listing scraped a non-empty 報酬 line (non-whitespace). */
export const listingPriceIsSet = (job: ScrapedJobType): boolean => {
  const p = (job.price || "").replace(/\s/g, "");
  return p.length > 0;
};

/** Whether a new job should trigger Telegram + bid flow for the given mode. */
export const jobPassesPopupPriceFilter = (
  job: ScrapedJobType,
  mode: JobNotifyPriceMode,
): boolean => {
  if (mode === "any") return true;
  // set: 予算が掲示されていて 最大が 0〜BID_MAX_BUDGET_JPY（例: 20万円 = 20万 まで）
  const maxBudget = getMaxListingBudgetJPY(job.price);
  if (maxBudget === null) return false;
  return maxBudget >= 0 && maxBudget <= BID_MAX_BUDGET_JPY;
};

/** `JOB_NOTIFY_PRICE`: `any` = all new jobs, `set` = only 0~200,000 円相当の表示予算. Aliases: budget. */
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
 * Only bid when listing looks eligible: has a price line, not too many competitors, enough description.
 */
export const shouldBid = (job: ScrapedJobType): boolean => {
  if (!job.price || job.price.replace(/\s/g, "").length === 0) {
    return false;
  }
  const proposals = parseProposalCount(job.suggestions);
  if (proposals >= 30) {
    return false;
  }
  const maxBudget = getMaxListingBudgetJPY(job.price);
  if (maxBudget === null || maxBudget > BID_MAX_BUDGET_JPY) {
    return false;
  }
  const desc = (job.desc || "").replace(/\s+/g, " ").trim();
  if (desc.length <= 50) {
    return false;
  }
  return true;
};
