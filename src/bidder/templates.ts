import { readFileSync } from "fs";
import { join } from "path";

/**
 * `data/*` is next to project root, not `process.cwd()` (which breaks when
 * running from `dist/`, PM2, or another directory).
 * Use `import { join }` — `import path from "path"` can be undefined under some ts-node settings.
 */
const DATA_DIR = join(__dirname, "..", "..", "data");
const dataPath = (...parts: string[]) => join(DATA_DIR, ...parts);

let estimateCache: string | null = null;
let promptTemplateCache: string | null = null;
let bidTemplateCache: string | null = null;

export const getEstimateTemplate = (): string => {
  if (estimateCache !== null) return estimateCache;
  const f = dataPath("estimate.txt");
  try {
    estimateCache = readFileSync(f, "utf-8").trim();
  } catch (e) {
    console.warn(`[BID] Missing ${f} — using default estimate.`, (e as Error).message);
    estimateCache =
      "詳細はミーティング等で擦り合わせさせてください。細かい仕様やスケジュールはご相談の上、合意形成できれば幸いです。";
  }
  return estimateCache;
};

export const getPromptTemplate = (): string => {
  if (promptTemplateCache !== null) return promptTemplateCache;
  const f = dataPath("prompt.txt");
  try {
    promptTemplateCache = readFileSync(f, "utf-8");
  } catch (e) {
    console.warn(`[BID] Missing ${f} — using default prompt.`, (e as Error).message);
    promptTemplateCache =
      "Write a concise Japanese proposal for the following project.\nTitle: {{title}}\n\nDescription:\n{{desc}}\n";
  }
  return promptTemplateCache;
};

export const fillPromptTemplate = (
  job: { title: string; desc: string; price: string },
): string => {
  return getPromptTemplate()
    .replace(/\{\{title\}\}/g, job.title)
    .replace(/\{\{desc\}\}/g, job.desc)
    .replace(/\{\{price\}\}/g, job.price || "(not shown)");
};

/** Proposal body for Playwright; read from `data/template.txt` when `BID_TEXT_SOURCE=template`. */
export const getBidTextTemplate = (): string => {
  if (bidTemplateCache !== null) return bidTemplateCache;
  const f = dataPath("template.txt");
  try {
    bidTemplateCache = readFileSync(f, "utf-8");
    const lines = bidTemplateCache.split("\n").length;
    console.log(
      `[BID] Loaded template.txt (${lines} lines, ${bidTemplateCache.length} chars) ← ${f}`,
    );
  } catch (e) {
    console.warn(
      `[BID] Could not read ${f} — using short built-in template. Set correct working directory or keep data/ next to the app.`,
      (e as Error).message,
    );
    bidTemplateCache =
      "拝見いたしました。{{title}}の内容について、ぜひ担当させてください。要件を踏まえ、丁寧に擦り合わせの上で進めます。報酬面は{{price}}の範囲で承知しております。まずはメッセージにて内容を深掘りし、最適な進め方をご提案したく存じます。よろしくお願いいたします。";
  }
  return bidTemplateCache;
};

export const fillBidTemplate = (job: {
  title: string;
  desc: string;
  price: string;
  url: string;
  category?: string;
  id?: string;
}): string => {
  const jobId = job.id || job.url.split("/").pop() || "";
  return getBidTextTemplate()
    .replace(/\{\{title\}\}/g, job.title)
    .replace(/\{\{desc\}\}/g, job.desc)
    .replace(/\{\{price\}\}/g, job.price || "（要相談）")
    .replace(/\{\{url\}\}/g, job.url)
    .replace(/\{\{category\}\}/g, job.category || "")
    .replace(/\{\{jobId\}\}/g, jobId);
};
