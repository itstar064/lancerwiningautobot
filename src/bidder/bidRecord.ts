import axios from "axios";
import config from "@/config";
import type { ScrapedJobType } from "@/types/job";
import { pickMilestoneAmountJPY } from "./placeBidPlaywright";

export type BidRecordPayload = {
  platform: "lancers";
  account_id: string;
  account_url: string;
  job_id: string;
  job_url: string;
  bid_content: string;
  budget: string;
  bid_time: string;
  is_bot: string;
  bid_place_number: number | null;
};

const RECORD_TIMEOUT_MS = 20_000;

function parseRankFromResponse(
  data: unknown,
  userId: string,
): number | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  const raw = row[userId];
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.floor(raw);
  if (typeof raw === "string") {
    const n = Number(raw.trim());
    if (Number.isFinite(n)) return Math.floor(n);
  }
  return null;
}

/**
 * POST rank service with proposals page URL + Lancers account id (same as LANCERS_ACCOUNT_ID).
 */
export async function fetchBidPlaceNumber(jobId: string): Promise<number | null> {
  const url = config.BID_RANKS_API_URL;
  if (!url) return null;
  const userId = config.LANCERS_ACCOUNT_ID;
  if (!userId) return null;

  const proposalsUrl = `https://www.lancers.jp/work/proposals/${jobId}`;
  try {
    const res = await axios.post<unknown>(
      url,
      { proposalsUrl, userId },
      {
        timeout: RECORD_TIMEOUT_MS,
        headers: { "content-type": "application/json" },
        validateStatus: () => true,
      },
    );
    if (res.status < 200 || res.status >= 300) {
      const preview =
        typeof res.data === "string"
          ? res.data.slice(0, 200)
          : JSON.stringify(res.data).slice(0, 200);
      console.warn(
        `[BID-RANK] HTTP ${res.status} jobId=${jobId}; preview: ${preview}`,
      );
      return null;
    }
    const rank = parseRankFromResponse(res.data, userId);
    if (rank == null) {
      console.warn(
        `[BID-RANK] No rank for userId=${userId} jobId=${jobId}; body=${JSON.stringify(res.data).slice(0, 200)}`,
      );
    } else {
      console.log(`[BID-RANK] jobId=${jobId} rank=${rank}`);
    }
    return rank;
  } catch (e) {
    console.warn(
      `[BID-RANK] Failed jobId=${jobId}:`,
      (e as Error).message,
    );
    return null;
  }
}

/**
 * Notify bid-server after a successful Lancers proposal.
 * Requires `LANCERS_ACCOUNT_ID`, `LANCERS_ACCOUNT_URL`; skips if `BID_RECORD_URL` is empty.
 */
export async function reportBidCompleted(
  job: ScrapedJobType,
  jobId: string,
  bidContent: string,
): Promise<void> {
  if (!config.BID_RECORD_URL) {
    return;
  }
  if (!config.LANCERS_ACCOUNT_ID || !config.LANCERS_ACCOUNT_URL) {
    console.log(
      "[BID-RECORD] Skip: set LANCERS_ACCOUNT_ID and LANCERS_ACCOUNT_URL",
    );
    return;
  }

  const jobUrl =
    job.url?.trim() && job.url.includes("lancers.jp")
      ? job.url.trim()
      : `https://www.lancers.jp/work/detail/${jobId}`;

  const bidPlaceNumber = await fetchBidPlaceNumber(jobId);

  const payload: BidRecordPayload = {
    platform: "lancers",
    account_id: config.LANCERS_ACCOUNT_ID,
    account_url: config.LANCERS_ACCOUNT_URL,
    job_id: jobId,
    job_url: jobUrl,
    bid_content: bidContent,
    budget: String(pickMilestoneAmountJPY(job.price)),
    bid_time: new Date().toISOString(),
    is_bot: "true",
    bid_place_number: bidPlaceNumber,
  };

  try {
    const res = await axios.post<unknown>(config.BID_RECORD_URL, payload, {
      timeout: RECORD_TIMEOUT_MS,
      headers: { "content-type": "application/json" },
      validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300) {
      const preview =
        typeof res.data === "string"
          ? res.data.slice(0, 300)
          : JSON.stringify(res.data).slice(0, 300);
      console.error(
        `[BID-RECORD] HTTP ${res.status} jobId=${jobId}; preview: ${preview}`,
      );
      return;
    }
    console.log(
      `[BID-RECORD] Posted jobId=${jobId}` +
        (bidPlaceNumber != null ? ` bid_place_number=${bidPlaceNumber}` : ""),
    );
  } catch (e) {
    console.error(
      `[BID-RECORD] Failed jobId=${jobId}:`,
      (e as Error).message,
    );
  }
}
