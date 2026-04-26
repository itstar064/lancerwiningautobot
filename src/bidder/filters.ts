import type { ScrapedJobType } from "@/types/job";

/** Parse first integer from strings like "12名が応募" or "5" */
export const parseProposalCount = (s: string): number => {
  const m = (s || "").match(/(\d+)/);
  if (!m) return 0;
  return parseInt(m[1], 10);
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
  const desc = (job.desc || "").replace(/\s+/g, " ").trim();
  if (desc.length <= 50) {
    return false;
  }
  return true;
};
