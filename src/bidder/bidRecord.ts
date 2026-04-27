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
};

const RECORD_TIMEOUT_MS = 20_000;

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

  const payload: BidRecordPayload = {
    platform: "lancers",
    account_id: config.LANCERS_ACCOUNT_ID,
    account_url: config.LANCERS_ACCOUNT_URL,
    job_id: jobId,
    job_url: jobUrl,
    bid_content: bidContent,
    budget: String(pickMilestoneAmountJPY(job.price)),
    bid_time: new Date().toISOString(),
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
    console.log(`[BID-RECORD] Posted jobId=${jobId}`);
  } catch (e) {
    console.error(
      `[BID-RECORD] Failed jobId=${jobId}:`,
      (e as Error).message,
    );
  }
}
