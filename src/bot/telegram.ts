import config from "@/config";
import { Telegraf } from "telegraf";
import { isEmpty } from "@/utils";
import type { ScrapedJobType } from "@/types/job";

export const telegraf = new Telegraf(config.BOT_TOKEN);

function escapeTelegramHtml(s: string): string {
  const lt = String.fromCharCode(60);
  const gt = String.fromCharCode(62);
  return s
    .replace(/&/g, "&amp;")
    .split(lt)
    .join("&lt;")
    .split(gt)
    .join("&gt;");
}

function escapeHref(s: string): string {
  return s.replace(/&/g, "&amp;");
}

const TELEGRAM_CAPTION_MAX = 1024;
const TELEGRAM_MESSAGE_MAX = 4096;

export const sendMessage = async (
  chatId: string,
  text: string,
  avatarUrl?: string,
) => {
  try {
    const extra = { parse_mode: "HTML" as const };

    if (!isEmpty(avatarUrl)) {
      await telegraf.telegram.sendPhoto(chatId, avatarUrl, {
        caption: text,
        parse_mode: "HTML",
      });
    } else {
      await telegraf.telegram.sendMessage(chatId, text, extra);
    }
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error(`[ERROR] Telegram sendMessage: ${e?.message}`);
  }
};

/**
 * After a successful bid: title, budget, URL, bid text, job id. Respects caption/message limits.
 */
export const sendBidResultNotification = async (
  chatId: string,
  job: ScrapedJobType,
  jobId: string,
  bidText: string,
  opts: { success: boolean },
) => {
  const header = opts.success
    ? "✅ <b>提案を送信しました</b>\n\n"
    : "⚠️ <b>提案結果</b>\n\n";

  const lines: string[] = [
    header,
    `<b>タイトル</b> ${escapeTelegramHtml(job.title)}`,
    `<b>ID</b> <code>${escapeTelegramHtml(jobId)}</code>`,
  ];
  if (job.price) {
    lines.push(`<b>予算 / 表示</b> ${escapeTelegramHtml(job.price)}`);
  }
  if (job.url) {
    lines.push(`<a href="${escapeHref(job.url)}">案件URL</a>`);
  }
  lines.push("", "<b>生成した提案文</b>", escapeTelegramHtml(bidText));

  const isPhoto = !isEmpty(job.employerAvatar);
  const max = isPhoto ? TELEGRAM_CAPTION_MAX : TELEGRAM_MESSAGE_MAX;
  let full = lines.join("\n");
  if (full.length > max) {
    const over = full.length - max + 1;
    const shortBid =
      bidText.length > over + 20
        ? bidText.slice(0, bidText.length - over - 20) + "…"
        : bidText.slice(0, 20) + "…";
    lines[lines.length - 1] = escapeTelegramHtml(shortBid);
    full = lines.join("\n");
    if (full.length > max) {
      full = full.slice(0, max - 1) + "…";
    }
  }

  try {
    if (isPhoto) {
      await telegraf.telegram.sendPhoto(chatId, job.employerAvatar, {
        caption: full,
        parse_mode: "HTML",
      });
    } else {
      await telegraf.telegram.sendMessage(chatId, full, { parse_mode: "HTML" });
    }
  } catch (e: unknown) {
    const err = e as { message?: string };
    console.error(`[ERROR] sendBidResultNotification: ${err?.message}`);
  }
};
