import { readFileSync } from "fs";
import path from "path";

const dataPath = (...parts: string[]) =>
  path.join(process.cwd(), "data", ...parts);

let estimateCache: string | null = null;
let promptTemplateCache: string | null = null;

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
