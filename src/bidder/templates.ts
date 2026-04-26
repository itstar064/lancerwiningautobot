import { readFileSync } from "fs";
import path from "path";

const dataPath = (...parts: string[]) =>
  path.join(process.cwd(), "data", ...parts);

let estimateCache: string | null = null;
let promptTemplateCache: string | null = null;
let bidTemplateCache: string | null = null;

export const getEstimateTemplate = (): string => {
  if (estimateCache !== null) return estimateCache;
  try {
    estimateCache = readFileSync(dataPath("estimate.txt"), "utf-8").trim();
  } catch {
    estimateCache =
      "詳細はミーティング等で擦り合わせさせてください。細かい仕様やスケジュールはご相談の上、合意形成できれば幸いです。";
  }
  return estimateCache;
};

export const getPromptTemplate = (): string => {
  if (promptTemplateCache !== null) return promptTemplateCache;
  try {
    promptTemplateCache = readFileSync(dataPath("prompt.txt"), "utf-8");
  } catch {
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
  try {
    bidTemplateCache = readFileSync(dataPath("template.txt"), "utf-8");
  } catch {
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
