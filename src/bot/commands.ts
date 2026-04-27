import config from "@/config";
import { isEmpty } from "@/utils";
import { Telegraf } from "telegraf";
import { getScrapingStatus, startScraping, stopScraping } from "@/scraper";
import {
  placeBidWithSharedContext,
  generateBidFromAPI,
  shouldBid,
  canPlaceBidThisHour,
  recordBidPlaced,
} from "@/bidder";
import Job from "@/models/Job";
import type { ScrapedJobType } from "@/types/job";
import { sendBidResultNotification } from "./telegram";

const commands: {
  command: string;
  description: string;
}[] = [
  { command: "start", description: "Start the bot" },
  {
    command: "start_scraping",
    description: "Start scraping job postings",
  },
  {
    command: "stop_scraping",
    description: "Stop scraping job postings",
  },
];

let placingBid = false;

const snapshotToJob = (jobId: string, snap: Record<string, unknown>): ScrapedJobType => {
  return {
    id: jobId,
    title: (snap.title as string) || "",
    url:
      (snap.url as string) ||
      `https://www.lancers.jp/work/detail/${jobId}`,
    desc: (snap.desc as string) || "x".repeat(51),
    category: (snap.category as string) || "",
    price: (snap.price as string) || "",
    suggestions: (snap.suggestions as string) || "",
    daysLeft: (snap.daysLeft as string) || "",
    deadline: (snap.deadline as string) || "",
    postedDate: (snap.postedDate as string) || "",
    employer: (snap.employer as string) || "",
    employerUrl: (snap.employerUrl as string) || "",
    employerAvatar: (snap.employerAvatar as string) || "",
    tags: (snap.tags as string[]) || [],
    workType: (snap.workType as string) || "",
  };
};

const setup_commands = async (bot: Telegraf) => {
  await bot.telegram.setMyCommands(commands);

  bot.start(async (ctx) => {
    try {
      await ctx.reply(
        `Welcome to the *CrowedWorks Job Bidder Bot*, please select one of the following options.\n\n If you need assistance, please contact @stellaray777`,
        {
          parse_mode: "Markdown",
        },
      );
    } catch (error) {
      console.error("Error in /start:", error);
      await ctx.reply("An error occurred. Please try again later.");
    }
  });

  bot.on("callback_query", async (ctx) => {
    try {
      if (placingBid) {
        await ctx.answerCbQuery("Please wait, a bid is already being placed.");
        return;
      }
      placingBid = true;
      const data = (ctx.callbackQuery as { data?: string }).data;
      if (data && data.startsWith("bid_action|")) {
        const [, clickedChatId] = data.split("|");
        console.log(`[BID] Manual callback: job id ${clickedChatId}`);

        if (isEmpty(clickedChatId)) {
          await ctx.answerCbQuery("Invalid job ID.");
          placingBid = false;
          return;
        }

        const found = await Job.findOne({ id: clickedChatId });
        if (!found) {
          await ctx.answerCbQuery("Job not in DB (scrape first).");
          placingBid = false;
          return;
        }

        if (found.bidPlaced) {
          await ctx.answerCbQuery("Already placed a bid for this job.");
          placingBid = false;
          return;
        }

        const raw = (found as { lastSnapshot?: Record<string, unknown> })
          .lastSnapshot;
        if (!raw || Object.keys(raw).length === 0) {
          await ctx.answerCbQuery("No job snapshot. Wait for a fresh scrape.");
          placingBid = false;
          return;
        }

        const job = snapshotToJob(clickedChatId, raw);

        if (
          !shouldBid(
            job,
            config.BID_MIN_BUDGET_JPY,
            config.BID_MAX_BUDGET_JPY,
          )
        ) {
          await ctx.answerCbQuery(
            `Budget outside ${config.BID_MIN_BUDGET_JPY}–${config.BID_MAX_BUDGET_JPY} JPY (parsed from listing).`,
          );
          console.log(
            `[BID] Skipped (manual): budget range jobId=${clickedChatId}`,
          );
          placingBid = false;
          return;
        }
        if (!canPlaceBidThisHour()) {
          await ctx.answerCbQuery(
            `Bid limit (${config.BID_MAX_PER_WINDOW} / ${config.BID_RATE_WINDOW_MS}ms) reached. Try later.`,
          );
          placingBid = false;
          return;
        }

        const bidText = await generateBidFromAPI(job);
        if (!bidText) {
          await ctx.answerCbQuery("Bid API did not return text.");
          placingBid = false;
          return;
        }

        const ok = await placeBidWithSharedContext(job, bidText);
        if (ok) {
          recordBidPlaced();
          found.bidPlaced = true;
          await found.save();
          await sendBidResultNotification(
            String(config.ADMIN_ID),
            job,
            clickedChatId,
            bidText,
            { success: true },
          );
          try {
            await ctx.answerCbQuery("Bid sent.");
          } catch (error) {
            console.error("[ERROR] answerCbQuery", error);
          }
          await ctx.reply("Bid placed successfully.");
        } else {
          try {
            await ctx.answerCbQuery("Could not complete bid (see logs).");
          } catch (error) {
            console.error("[ERROR] answerCbQuery", error);
          }
        }
        placingBid = false;
        return;
      }
      placingBid = false;
    } catch (error) {
      placingBid = false;
      console.error("[ERROR] callback_query", error);
      await ctx.reply("An error occurred. Please try again later.");
    }
  });

  let canStart = false;

  bot.command("start_scraping", async (ctx) => {
    try {
      const userId = ctx.update.message.from.id;
      if (config.ADMIN_ID !== userId.toString())
        return await ctx.reply(`🚫 This command is for admin only.`);

      const scraping = getScrapingStatus();

      if (scraping) return await ctx.reply("Scraping is already ongoing.");

      if (!canStart)
        return await ctx.reply("Scraping is not allowed to start for now.");

      await ctx.reply("🔍 Scraping started.");
      startScraping();
    } catch (error) {
      console.error("Error in /start_scraping:", error);
      await ctx.reply("An error occurred. Please try again later.");
    }
  });

  bot.command("stop_scraping", async (ctx) => {
    try {
      const userId = ctx.update.message.from.id;
      if (config.ADMIN_ID !== userId.toString())
        return await ctx.reply(`🚫 This command is for admin only.`);

      const scraping = getScrapingStatus();

      if (!scraping) return await ctx.reply("Scraping is not ongoing.");

      canStart = false;

      setTimeout(() => {
        canStart = true;
      }, 60000);

      await ctx.reply("🛑 Scraping stopped.");
      stopScraping();
    } catch (error) {
      console.error("Error in /stop_scraping:", error);
      await ctx.reply("An error occurred. Please try again later.");
    }
  });
};

export default setup_commands;
