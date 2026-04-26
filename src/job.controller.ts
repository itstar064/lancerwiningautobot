import { sendMessage, sendBidResultNotification } from "./bot/telegram";
import Job from "./models/Job";
import { ScrapedJobType } from "./types/job";
import { delay } from "./utils";
import {
  shouldBid,
  generateBidFromAPI,
  canPlaceBidThisHour,
  recordBidPlaced,
  placeBidWithSharedContext,
} from "./bidder";

/** Telegram HTML mode: escape user-controlled text. */
const escapeTelegramHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `href` attribute: `&` must be escaped for HTML parse mode. */
const escapeHref = (s: string) => s.replace(/&/g, "&amp;");

const TELEGRAM_CAPTION_MAX = 1024;
const TELEGRAM_MESSAGE_MAX = 4096;

const jobSnapshot = (job: ScrapedJobType) => ({
  id: job.id,
  title: job.title,
  url: job.url,
  desc: job.desc,
  category: job.category,
  price: job.price,
  suggestions: job.suggestions,
  daysLeft: job.daysLeft,
  deadline: job.deadline,
  postedDate: job.postedDate,
  employer: job.employer,
  employerUrl: job.employerUrl,
  employerAvatar: job.employerAvatar,
  tags: job.tags,
  workType: job.workType,
});

const processScrapedJob = async (userid: string, jobs: ScrapedJobType[]) => {
  console.log(`[SCRAPER] Processing ${jobs.length} jobs...`);
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const jobid = job.id || job.url.split("/").pop() || "";
    console.log(`[SCRAPER] Checking job ID: ${jobid}`);

    let inserted = false;
    try {
      const result = await Job.updateOne(
        { id: jobid },
        {
          $setOnInsert: {
            id: jobid,
            bidPlaced: false,
            lastSnapshot: jobSnapshot(job),
          },
        },
        { upsert: true },
      );
      inserted = result.upsertedCount === 1;
    } catch (err: unknown) {
      const e = err as { code?: number };
      if (e?.code === 11000) {
        inserted = false;
      } else {
        throw err;
      }
    }

    if (inserted) {
      console.log(`[SCRAPER] New job: ${jobid} — ${job.title}`);

      const maxLen = job.employerAvatar
        ? TELEGRAM_CAPTION_MAX
        : TELEGRAM_MESSAGE_MAX;

      let message = `🔉 <b>${escapeTelegramHtml(job.title)}</b>\n\n`;

      if (jobid) {
        message += `<b>ID:</b> ${escapeTelegramHtml(jobid)}\n`;
        message += `<b>依頼者:</b> ${escapeTelegramHtml(job.employer)}\n`;
      }

      if (job.category) {
        message += `<b>カテゴリ:</b> ${escapeTelegramHtml(job.category)}\n`;
      }

      if (job.daysLeft) {
        message += `<b>期間:</b> ${escapeTelegramHtml(job.daysLeft)}\n`;
      }

      if (job.price) {
        message += `<b>報酬:</b> ${escapeTelegramHtml(job.price)}円\n`;
      }

      const linkFooter = job.url
        ? `\n\n<a href="${escapeHref(job.url)}">案件ページ</a>`
        : "";

      if (job.desc) {
        const header = "\n<b>概要:</b>\n";
        const plain = job.desc.replace(/\s+/g, " ").trim();
        const budget =
          maxLen - message.length - header.length - linkFooter.length;
        const ellipsis = "…";

        if (budget > 0 && plain) {
          let snippet = "";
          for (let len = plain.length; len >= 0; len--) {
            const cand =
              len === plain.length ? plain : plain.slice(0, len) + ellipsis;
            if (escapeTelegramHtml(cand).length <= budget) {
              snippet = cand;
              break;
            }
          }
          if (snippet) {
            message += header + escapeTelegramHtml(snippet);
          }
        }
      }

      if (linkFooter) {
        message += linkFooter;
      }

      await sendMessage(userid, message, job.employerAvatar);

      if (!shouldBid(job)) {
        console.log(
          `[BID] Skipped: filters (price empty, proposals>=30, or desc<=50) jobId=${jobid}`,
        );
      } else if (!canPlaceBidThisHour()) {
        console.log(`[BID] Skipped: max 5 bids per hour; jobId=${jobid}`);
      } else {
        const bidText = await generateBidFromAPI(job);
        if (!bidText) {
          console.log(`[BID] Skipped: no API text (null/short); jobId=${jobid}`);
        } else {
          const ok = await placeBidWithSharedContext(job, bidText);
          if (ok) {
            recordBidPlaced();
            await Job.updateOne({ id: jobid }, { $set: { bidPlaced: true } });
            console.log(`[BID] Success: jobId=${jobid}`);
            await sendBidResultNotification(userid, job, jobid, bidText, {
              success: true,
            });
          } else {
            console.log(`[BID] Failed or ambiguous: jobId=${jobid}`);
          }
        }
      }
    } else {
      console.log(`[SCRAPER] Already known, skip: ${jobid}`);
    }
    await delay(200);
  }
  console.log(`[SCRAPER] Finished processing ${jobs.length} jobs`);
};

export default processScrapedJob;
