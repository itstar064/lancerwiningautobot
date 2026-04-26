import { delay, isEmpty } from "@/utils";
import config from "@/config";
import processScrapedJob from "@/job.controller";
import axios from "axios";
import * as cheerio from "cheerio";
import {
  getAuthCookieHeader,
  resetLancersContext,
} from "@/browser/lancersContext";

let scraping = false;
const searchUrls = [
  "https://www.lancers.jp/work/search/system?open=1&show_description=1&sort=started&type%5B%5D=competition&type%5B%5D=project&type%5B%5D=task&work_rank%5B%5D=0&work_rank%5B%5D=2&work_rank%5B%5D=3",
  "https://www.lancers.jp/work/search/web?open=1&show_description=1&sort=started&type%5B%5D=competition&type%5B%5D=project&type%5B%5D=task&work_rank%5B%5D=0&work_rank%5B%5D=2&work_rank%5B%5D=3",
];

const SEARCH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36";
const SEARCH_REFERER = "https://www.lancers.jp/mypage";
const AXIOS_TIMEOUT_MS = 20000;

const rndScrapeMs = () => {
  const { SCRAPE_DELAY_MIN_MS: a, SCRAPE_DELAY_MAX_MS: b } = config;
  return a + Math.floor(Math.random() * (b - a + 1));
};

const fetchSearchHtml = async (url: string, cookieHeader: string) => {
  const res = await axios.get(url, {
    timeout: AXIOS_TIMEOUT_MS,
    headers: {
      "user-agent": SEARCH_USER_AGENT,
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "accept-language": "ja,en-US;q=0.9,en;q=0.8",
      referer: SEARCH_REFERER,
      cookie: cookieHeader,
    },
    responseType: "text",
  });

  return res.data as string;
};

const parseJobsFromSearchHtml = (html: string) => {
  const $ = cheerio.load(html);
  const cards = $(".p-search-job-media");
  const jobs: any[] = [];

  cards.each((_, card) => {
    const $card = $(card);

    const $titleAnchor = $card
      .find(".p-search-job-media__title.c-media__title")
      .first();

    const $tagsUl = $titleAnchor.find("ul.p-search-job-media__tags");
    if ($tagsUl.length > 0) $tagsUl.remove();

    const title = ($titleAnchor.text() || "").replace(/\s+/g, " ").trim();
    const href = $titleAnchor.attr("href") || "";
    const url = href ? `https://www.lancers.jp${href}` : "";

    let jobId = "";
    const onclickAttr = ($card.attr("onclick") || "").toString();
    const match = onclickAttr.match(/goToLjpWorkDetail\((\d+)\)/);
    if (match?.[1]) jobId = match[1];
    if (!jobId) {
      const urlMatch = href.match(/\/work\/detail\/(\d+)/);
      if (urlMatch?.[1]) jobId = urlMatch[1];
    }

    const daysLeft = (
      $card.find(".p-search-job-media__time-remaining").text() || ""
    )
      .replace(/\s+/g, " ")
      .trim();
    const deadline = (
      $card.find(".p-search-job-media__time-text").text() || ""
    )
      .replace(/\s+/g, " ")
      .trim();

    const priceNumbers = $card
      .find(".p-search-job-media__price .p-search-job-media__number")
      .toArray()
      .map((n) => $(n).text().replace(/\s+/g, " ").trim())
      .filter(Boolean);

    let price = "";
    if (priceNumbers.length >= 2) {
      price = `${priceNumbers[0]}~${priceNumbers[1]}`;
    } else if (priceNumbers.length === 1) {
      price = priceNumbers[0];
    }

    const $employerAnchor = $card
      .find(".p-search-job-media__avatar-note.c-avatar__note a")
      .first();
    const employer = ($employerAnchor.text() || "")
      .replace(/\s+/g, " ")
      .trim();
    const employerUrl = $employerAnchor.attr("href")
      ? `https://www.lancers.jp${$employerAnchor.attr("href")}`
      : "";

    const employerAvatar =
      $card.find(".c-avatar__image").first().attr("src") || "";

    const category = $card
      .find(".p-search-job__division-link")
      .toArray()
      .map((el) => $(el).text().replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(", ");

    const proposals = ($card.find(".p-search-job-media__proposals").text() || "")
      .replace(/\s+/g, " ")
      .trim();

    const workType = ($card.find(".c-badge__text").first().text() || "")
      .replace(/\s+/g, " ")
      .trim();

    const descriptionParts: string[] = [];
    $card.find(".c-media__description").each((_, el) => {
      const $el = $(el);
      if ($el.find("ul.p-search-job-media__tag-lists").length > 0) {
        return;
      }
      const text = ($el.text() || "").replace(/\s+/g, " ").trim();
      if (text) {
        descriptionParts.push(text);
      }
    });
    const desc = descriptionParts.join("\n\n").trim();

    jobs.push({
      id: jobId,
      title,
      url,
      desc,
      category,
      price,
      suggestions: proposals,
      daysLeft,
      deadline,
      postedDate: "",
      employer,
      employerUrl,
      employerAvatar,
      tags: [],
      workType,
    });
  });

  return jobs;
};

export async function scrapeJobs() {
  let iteration = 0;
  let cookieHeader: string | null = null;

  while (true) {
    if (!scraping) {
      break;
    }

    try {
      const searchUrl = searchUrls[iteration % searchUrls.length];

      if (isEmpty(searchUrl)) continue;

      if (!cookieHeader) {
        cookieHeader = await getAuthCookieHeader();
        console.log("[SCRAPER] Loaded cookies for search.");
      }

      let html = "";
      try {
        html = await fetchSearchHtml(searchUrl, cookieHeader);
        if (!html.includes("user_id")) {
          throw new Error("Login required (no user_id in page)");
        }
      } catch (err) {
        console.error(
          "[SCRAPER] Search fetch failed; re-login. ",
          (err as Error).message,
        );
        cookieHeader = await resetLancersContext();
        html = await fetchSearchHtml(searchUrl, cookieHeader);
      }

      const jobs = parseJobsFromSearchHtml(html);

      if (jobs.length === 0) {
        console.log(
          "[SCRAPER] No job cards; session may be invalid. Resetting context.",
        );
        cookieHeader = null;
        await resetLancersContext();
        continue;
      }

      console.log(`[SCRAPER] Scraped ${jobs.length} job cards.`);
      jobs.forEach((job: { id?: string; url: string; title: string }) => {
        const jobId = job.id || (job.url ? job.url.split("/").pop() : "unknown");
        console.log(`[SCRAPER] ID ${jobId} — ${job.title || "(no title)"}`);
      });

      try {
        await processScrapedJob(config.ADMIN_ID, jobs.reverse());
      } catch (err) {
        console.error(
          "[ERROR] processScrapedJob",
          (err as Error).message,
        );
      }
      await delay(rndScrapeMs());

      iteration++;
    } catch (err) {
      console.error("[ERROR] Scrape loop:", (err as Error).message);
    }
  }
}

export const startScraping = async () => {
  try {
    scraping = true;
    await scrapeJobs();
  } catch (error) {
    console.error(
      "[ERROR] startScraping",
      (error as Error).message,
    );
  }
};

export const stopScraping = () => {
  scraping = false;
};

export const getScrapingStatus = () => {
  return scraping;
};
