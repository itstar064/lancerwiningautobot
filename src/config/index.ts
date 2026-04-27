import { configDotenv } from "dotenv";
import type { JobNotifyPriceMode } from "@/bidder/filters";
import { parseJobNotifyPriceMode } from "@/bidder/filters";

configDotenv();
const PORT = process.env.PORT || "5000";
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;
const ADMIN_ID = process.env.ADMIN_ID;
const OPENAI = process.env.OPENAI_API || "";
const BID_API_URL =
  process.env.BID_API_URL ||
  "http://135.181.224.37:3000/api/project-links";
const BID_API_KEY = process.env.BID_API_KEY || "";
const BID_API_COUNT = process.env.BID_API_COUNT || "5";
const BID_API_TIMEOUT_MS = Number(process.env.BID_API_TIMEOUT_MS) || 120_000;
const _bidSrc = (process.env.BID_TEXT_SOURCE || "template").toLowerCase();
const BID_TEXT_SOURCE: "api" | "template" = _bidSrc === "api" ? "api" : "template";

/** Random pause between Playwright steps on propose pages (ms). */
const BID_BROWSER_DELAY_MIN_MS =
  Math.max(0, Number(process.env.BID_BROWSER_DELAY_MIN_MS) || 1000);
const BID_BROWSER_DELAY_MAX_MS = Math.max(
  BID_BROWSER_DELAY_MIN_MS,
  Number(process.env.BID_BROWSER_DELAY_MAX_MS) || 3000,
);

/** 完了予定日: today + this many days (Lancers form). */
const BID_COMPLETION_DAYS = Math.max(
  1,
  Number(process.env.BID_COMPLETION_DAYS) || 14,
);

/** Max autobids per rolling window (anti-ban + platform courtesy). */
const BID_MAX_PER_WINDOW = Math.max(1, Number(process.env.BID_MAX_PER_WINDOW) || 5);
const BID_RATE_WINDOW_MS = Math.max(
  60_000,
  Number(process.env.BID_RATE_WINDOW_MS) || 60 * 60 * 1000,
);

/** Cooldown between full scrape loop iterations (ms). */
const SCRAPE_DELAY_MIN_MS = Math.max(0, Number(process.env.SCRAPE_DELAY_MIN_MS) || 4000);
const SCRAPE_DELAY_MAX_MS = Math.max(
  SCRAPE_DELAY_MIN_MS,
  Number(process.env.SCRAPE_DELAY_MAX_MS) || 8000,
);

/** POST completed bids to external server (empty = disabled). */
const BID_RECORD_URL_RAW = process.env.BID_RECORD_URL;
const BID_RECORD_URL =
  BID_RECORD_URL_RAW === undefined || BID_RECORD_URL_RAW === null
    ? "https://bid-server.vercel.app/api/bids"
    : BID_RECORD_URL_RAW.trim();
const LANCERS_ACCOUNT_ID = (process.env.LANCERS_ACCOUNT_ID || "").trim();
const LANCERS_ACCOUNT_URL = (process.env.LANCERS_ACCOUNT_URL || "").trim();

/** New job Telegram + bid: `any` = all, `set` = only 0~200,000 円相当の掲示予算 (any | set, alias set: budget). */
const JOB_NOTIFY_PRICE: JobNotifyPriceMode = parseJobNotifyPriceMode(
  process.env.JOB_NOTIFY_PRICE,
);

let config_missing = false;

if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN");
  config_missing = true;
}

if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI");
  config_missing = true;
}

if (!EMAIL) {
  console.error("Missing EMAIL");
  config_missing = true;
}

if (!PASSWORD) {
  console.error("Missing PASSWORD");
  config_missing = true;
}

if (!ADMIN_ID) {
  console.error("Missing ADMIN_ID");
  config_missing = true;
}
// OPENAI is optional (legacy; bidding uses BID_API_URL)

if (config_missing) {
  process.exit(1);
}

interface Config {
  PORT: number;
  BOT_TOKEN: string;
  MONGODB_URI: string;
  EMAIL: string;
  PASSWORD: string;
  ADMIN_ID: string;
  OPENAI_API: string;
  BID_API_URL: string;
  BID_API_KEY: string;
  BID_API_COUNT: string;
  BID_API_TIMEOUT_MS: number;
  /** Use external API vs local `data/template.txt` for proposal body. */
  BID_TEXT_SOURCE: "api" | "template";
  BID_BROWSER_DELAY_MIN_MS: number;
  BID_BROWSER_DELAY_MAX_MS: number;
  BID_COMPLETION_DAYS: number;
  BID_MAX_PER_WINDOW: number;
  BID_RATE_WINDOW_MS: number;
  SCRAPE_DELAY_MIN_MS: number;
  SCRAPE_DELAY_MAX_MS: number;
  /** POST JSON after a successful Lancers bid; empty string disables. */
  BID_RECORD_URL: string;
  LANCERS_ACCOUNT_ID: string;
  LANCERS_ACCOUNT_URL: string;
  /** Filter new-job Telegram + bid path by listing 報酬 line present or not. */
  JOB_NOTIFY_PRICE: JobNotifyPriceMode;
  PROXY: string | undefined;
  PROXY_AUTH: { username: string; password: string } | undefined;
}

const config: Config = {
  PORT: Number(PORT),
  BOT_TOKEN: BOT_TOKEN!,
  MONGODB_URI: MONGODB_URI!,
  EMAIL: EMAIL!,
  PASSWORD: PASSWORD!,
  ADMIN_ID: ADMIN_ID!,
  OPENAI_API: OPENAI,
  BID_API_URL,
  BID_API_KEY,
  BID_API_COUNT,
  BID_API_TIMEOUT_MS,
  BID_TEXT_SOURCE,
  BID_BROWSER_DELAY_MIN_MS,
  BID_BROWSER_DELAY_MAX_MS,
  BID_COMPLETION_DAYS,
  BID_MAX_PER_WINDOW,
  BID_RATE_WINDOW_MS,
  SCRAPE_DELAY_MIN_MS,
  SCRAPE_DELAY_MAX_MS,
  BID_RECORD_URL,
  LANCERS_ACCOUNT_ID,
  LANCERS_ACCOUNT_URL,
  JOB_NOTIFY_PRICE,
  PROXY: process.env.PROXY,
  PROXY_AUTH: process.env.PROXY_AUTH ? JSON.parse(process.env.PROXY_AUTH) : undefined,
};

export default config;
