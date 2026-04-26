import axios from "axios";
import type { ScrapedJobType } from "@/types/job";
import config from "@/config";
import { fillPromptTemplate } from "./templates";

export type BidApiPayload = {
  jobId: string;
  prompt: string;
  job: {
    title: string;
    desc: string;
    price: string;
    url: string;
    category?: string;
    suggestions?: string;
  };
};

const TIMEOUT_MS = 12000;
const MIN_LEN = 50;
const MAX_ATTEMPTS = 2;

/**
 * POST to external bid API. Returns null if disabled, empty, or too short.
 */
export const generateBidFromAPI = async (
  job: ScrapedJobType,
): Promise<string | null> => {
  const url = config.BID_API_URL;
  if (!url) {
    console.log("[API] BID_API_URL not set; skip bid generation.");
    return null;
  }

  const payload: BidApiPayload = {
    jobId: job.id || job.url.split("/").pop() || "",
    prompt: fillPromptTemplate(job),
    job: {
      title: job.title,
      desc: job.desc,
      price: job.price,
      url: job.url,
      category: job.category,
      suggestions: job.suggestions,
    },
  };

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(
        `[API] POST ${url} (attempt ${attempt}/${MAX_ATTEMPTS}) jobId=${payload.jobId}`,
      );
      const res = await axios.post(url, payload, {
        timeout: TIMEOUT_MS,
        headers: {
          "content-type": "application/json",
          ...(config.BID_API_KEY
            ? { Authorization: `Bearer ${config.BID_API_KEY}` }
            : {}),
        },
        validateStatus: () => true,
      });

      const data = res.data as
        | string
        | { text?: string; bid?: string; message?: string };
      let text = "";
      if (typeof data === "string") {
        text = data;
      } else if (data && typeof data === "object") {
        text =
          (data.text as string) ||
          (data.bid as string) ||
          (data.message as string) ||
          "";
      }

      text = (text || "").trim();
      if (text.length < MIN_LEN) {
        console.log(
          `[API] Response too short (${text.length} chars); treating as null.`,
        );
        return null;
      }
      return text;
    } catch (e) {
      lastErr = e;
      console.error(
        `[API] attempt ${attempt} failed:`,
        (e as Error).message,
      );
    }
  }
  console.error("[API] All attempts failed:", lastErr);
  return null;
};
