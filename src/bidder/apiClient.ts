import axios from "axios";
import type { ScrapedJobType } from "@/types/job";
import config from "@/config";
import { fillBidTemplate, fillPromptTemplate } from "./templates";

/**
 * Request body for `POST /api/project-links` (bid text generation).
 */
export type ProjectLinksRequest = {
  category: string;
  jobID: string;
  description: string;
  jobLink: string;
  count: string;
  prompt: string;
};

const MIN_LEN = 50;
const MAX_ATTEMPTS = 2;

const pickString = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

/**
 * POST /api/project-links style:
 * `{ bids: "…", links: [ … ], jobId, … }` — the proposal body is `bids` (plural).
 */
export type ProjectLinksResponse = {
  jobId?: string;
  jobLink?: string;
  category?: string;
  description?: string;
  requestedCount?: number;
  returnedCount?: number;
  links?: string[];
  sourceSummary?: { fromDb?: number; generated?: number };
  /** Main proposal text (日本語) */
  bids?: string;
  text?: string;
  bid?: string;
  message?: string;
  [k: string]: unknown;
};

/**
 * Reads generated bid text from API JSON. Prefers `bids` (project-links service).
 */
const extractBidTextFromResponse = (data: unknown): string => {
  if (data == null) return "";

  if (typeof data === "string") {
    return data.trim();
  }

  if (typeof data !== "object") return "";

  const o = data as Record<string, unknown>;

  const direct =
    pickString(o.bids) ||
    pickString(o.text) ||
    pickString(o.bid) ||
    pickString(o.message) ||
    pickString(o.content) ||
    pickString(o.result) ||
    pickString(o.proposal) ||
    pickString(o.body) ||
    pickString(o.output) ||
    pickString(o.response);
  if (direct) return direct;

  const nested = o.data;
  if (typeof nested === "string") return nested.trim();
  if (nested && typeof nested === "object") {
    const d = nested as Record<string, unknown>;
    const n =
      pickString(d.bids) ||
      pickString(d.text) ||
      pickString(d.bid) ||
      pickString(d.content) ||
      pickString(d.result);
    if (n) return n;
  }

  if (Array.isArray(o.links)) {
    const parts = o.links
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const r = item as Record<string, unknown>;
          return (
            pickString(r.description) ||
            pickString(r.text) ||
            pickString(r.url) ||
            ""
          );
        }
        return "";
      })
      .filter(Boolean);
    if (parts.length) return parts.join("\n\n");
  }

  if (o.bid && typeof o.bid === "object") {
    const b = o.bid as Record<string, unknown>;
    const t = pickString(b.text) || pickString(b.content);
    if (t) return t;
  }

  return "";
};

/**
 * Resolves bid body: `BID_TEXT_SOURCE=template` uses `data/template.txt`;
 * `api` calls the external bid API.
 */
export const generateBidFromAPI = async (
  job: ScrapedJobType,
): Promise<string | null> => {
  const jobID = job.id || job.url.split("/").pop() || "";

  if (config.BID_TEXT_SOURCE === "template") {
    const text = fillBidTemplate({
      id: job.id,
      title: job.title,
      desc: job.desc,
      price: job.price,
      url: job.url,
      category: job.category,
    }).trim();
    console.log(
      `[BID] Using data/template.txt (BID_TEXT_SOURCE=template) jobId=${jobID}`,
    );
    if (text.length < MIN_LEN) {
      console.log(
        `[BID] Template bid too short (${text.length} chars); min ${MIN_LEN}.`,
      );
      return null;
    }
    return text;
  }

  const url = config.BID_API_URL;
  if (!url) {
    console.log("[API] BID_TEXT_SOURCE=api but BID_API_URL not set; skip.");
    return null;
  }
  const category = (job.category || "一般").replace(/\s+/g, " ").trim() || "一般";

  const payload: ProjectLinksRequest = {
    category,
    jobID,
    description: (job.desc || job.title || "").replace(/\s+/g, " ").trim(),
    jobLink: job.url,
    count: config.BID_API_COUNT,
    prompt: fillPromptTemplate(job),
  };

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(
        `[API] POST ${url} (attempt ${attempt}/${MAX_ATTEMPTS}) jobId=${jobID}`,
      );
      const res = await axios.post<unknown>(url, payload, {
        timeout: config.BID_API_TIMEOUT_MS,
        headers: {
          "content-type": "application/json",
          ...(config.BID_API_KEY
            ? { Authorization: `Bearer ${config.BID_API_KEY}` }
            : {}),
        },
        validateStatus: () => true,
      });

      if (res.status < 200 || res.status >= 300) {
        const preview =
          typeof res.data === "string"
            ? res.data.slice(0, 400)
            : JSON.stringify(res.data).slice(0, 400);
        console.log(
          `[API] HTTP ${res.status} for jobId=${jobID}; body preview: ${preview}`,
        );
        if (attempt < MAX_ATTEMPTS) continue;
        return null;
      }

      const text = extractBidTextFromResponse(res.data).trim();
      if (text.length < MIN_LEN) {
        const raw =
          typeof res.data === "string"
            ? res.data.slice(0, 200)
            : JSON.stringify(res.data).slice(0, 200);
        console.log(
          `[API] Response too short (${text.length} chars) or unparseable; raw≈ ${raw}`,
        );
        if (attempt < MAX_ATTEMPTS) continue;
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
