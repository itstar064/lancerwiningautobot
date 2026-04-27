import type { ScrapedJobType } from "@/types/job";

/** Parse first integer from strings like "12名が応募" or "5" */
export const parseProposalCount = (s: string): number => {
  const m = (s || "").match(/(\d+)/);
  if (!m) return 0;
  return parseInt(m[1], 10);
};

const BID_MAX_PRICE_JPY = 200_000;

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
const parseMaxBudgetJPY = (priceText: string): number | null => {
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
  const maxBudget = parseMaxBudgetJPY(job.price);
  if (maxBudget === null || maxBudget > BID_MAX_PRICE_JPY) {
    return false;
  }
  const desc = (job.desc || "").replace(/\s+/g, " ").trim();
  if (desc.length <= 50) {
    return false;
  }
  return true;
};
