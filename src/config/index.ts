import * as path from "path";
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

/** New job Telegram: `any` = all listings; `set` = only jobs whose parsed budget fits [min,max]. */
const JOB_NOTIFY_PRICE: JobNotifyPriceMode = parseJobNotifyPriceMode(
  process.env.JOB_NOTIFY_PRICE,
);

/** Empty env becomes `Number("") === 0` — must not treat as valid budget. */
const parseBudgetJPY = (
  raw: string | undefined,
  fallback: number,
): number => {
  const s = (raw ?? "").trim();
  if (s === "") return fallback;
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
};

let BID_MIN_BUDGET_JPY = parseBudgetJPY(process.env.BID_MIN_BUDGET_JPY, 0);
let BID_MAX_BUDGET_JPY = parseBudgetJPY(process.env.BID_MAX_BUDGET_JPY, 200_000);
if (BID_MAX_BUDGET_JPY <= 0) {
  console.warn(
    "[CONFIG] BID_MAX_BUDGET_JPY missing or invalid; using default 200000.",
  );
  BID_MAX_BUDGET_JPY = 200_000;
}
if (BID_MAX_BUDGET_JPY < BID_MIN_BUDGET_JPY) {
  console.warn(
    "[CONFIG] BID_MAX_BUDGET_JPY < BID_MIN_BUDGET_JPY; clamping max to min.",
  );
  BID_MAX_BUDGET_JPY = BID_MIN_BUDGET_JPY;
}

/** Playwright persistent profile (cookies survive process restarts). */
const _profileDir = (process.env.LANCERS_BROWSER_USER_DATA_DIR || "").trim();
const LANCERS_BROWSER_USER_DATA_DIR = path.resolve(
  _profileDir || path.join(process.cwd(), "data", "lancers-chromium-profile"),
);
const LANCERS_HEADLESS =
  process.env.LANCERS_HEADLESS === "true" ||
  process.env.LANCERS_HEADLESS === "1";

/** Abort CSS/fonts/images + known tracker scripts in Playwright (may affect layout; opt-in). */
const LANCERS_BLOCK_STATIC_ASSETS =
  process.env.LANCERS_BLOCK_STATIC_ASSETS === "true" ||
  process.env.LANCERS_BLOCK_STATIC_ASSETS === "1";

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
  JOB_NOTIFY_PRICE: JobNotifyPriceMode;
  /** Parsed listing budget high-end must be in [min, max] (yen) to auto-bid. */
  BID_MIN_BUDGET_JPY: number;
  BID_MAX_BUDGET_JPY: number;
  /** Absolute path passed to `chromium.launchPersistentContext`. */
  LANCERS_BROWSER_USER_DATA_DIR: string;
  /** Headless persistent Chromium (default false so first login / verify_code is visible). */
  LANCERS_HEADLESS: boolean;
  /** When true, block stylesheets/fonts/images/media + tracker scripts in Lancers browser. */
  LANCERS_BLOCK_STATIC_ASSETS: boolean;
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
  BID_MIN_BUDGET_JPY,
  BID_MAX_BUDGET_JPY,
  LANCERS_BROWSER_USER_DATA_DIR,
  LANCERS_HEADLESS,
  LANCERS_BLOCK_STATIC_ASSETS,
  PROXY: process.env.PROXY,
  PROXY_AUTH: process.env.PROXY_AUTH ? JSON.parse(process.env.PROXY_AUTH) : undefined,
};

export default config;
