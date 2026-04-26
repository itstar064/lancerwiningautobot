# Bot working flow (current)

This document describes the **current runtime flow** of this repository’s bot as implemented in `src/`.

## High-level overview

- **Goal**: watch for newly posted jobs on **Lancers** search pages, **dedupe** them via MongoDB, and **notify** a Telegram admin chat. There is also code for generating bid text with OpenAI; the actual “place bid” browser automation is currently commented out.

## Runtime entrypoint

- **File**: `src/index.ts`
- **Flow**:
  - Loads configuration and validates required environment variables (via `src/config/index.ts`).
  - Connects to MongoDB (via `src/db.ts`).
  - Starts the Telegram bot (via `src/bot/index.ts`).
  - Starts the scraping loop (via `src/scraper/index.ts`).

## Configuration / environment variables

- **File**: `src/config/index.ts`
- **Loads**: `.env` using `dotenv` (`configDotenv()`).
- **Exits the process** if any required variable is missing.

### Required variables

- `BOT_TOKEN`: Telegram bot token used by Telegraf.
- `MONGODB_URI`: MongoDB connection string for Mongoose.
- `EMAIL`: Lancers login email.
- `PASSWORD`: Lancers login password.
- `ADMIN_ID`: Telegram chat id that receives notifications (string).
- `OPENAI_API`: OpenAI API key (used in bidder module).

### Optional variables

- `PROXY`: Proxy URL (currently not wired into scraping in the checked-in code).
- `PROXY_AUTH`: JSON string like `{"username":"...","password":"..."}` (currently not wired into scraping in the checked-in code).

## Database connection

- **File**: `src/db.ts`
- **Function**: `connectDBWithRetry(retries = 3, delay = 2000)`
- **Flow**:
  - Attempts `mongoose.connect(config.MONGODB_URI)`.
  - Retries up to 3 times, waiting 2 seconds between attempts.
  - Exits the process after the final failure.

## Telegram bot startup + messaging

- **File**: `src/bot/index.ts`

### Startup

- `launchBot()` calls `bot.launch()` and resolves `"Bot started"` when Telegraf begins.
- Commands are registered via `setup_commands(bot)` in `src/bot/commands.ts`.

### Sending notifications

- `sendMessage(chatId, text, avatarUrl?)`
  - Uses Telegram **HTML parse mode**.
  - If `avatarUrl` is provided, sends a **photo** with `caption`.
  - Otherwise sends a standard text message.

## Scraping flow

- **File**: `src/scraper/index.ts`
- **Entry**: `startScraping()` → sets `scraping = true` → `scrapeJobs()`.

### 1) Login + cookie acquisition (Playwright)

- **Function**: `getAuthCookieHeaderWithPlaywright()`
- **What it does**:
  - Launches a Chromium browser using Playwright with `headless: false`.
    - This is intentionally **headed** because Lancers may require manual verification (e.g. `/verify_code`).
  - Opens `https://www.lancers.jp/user/login`.
  - Fills the login form with `config.EMAIL` + `config.PASSWORD`, submits.
  - If redirected to `/verify_code`, it waits indefinitely until the user completes verification and the page reaches `/mypage`.
  - Exports cookies from the browser context and returns them as an HTTP `cookie` header string.

### 2) Fetch search HTML (Axios)

- **Function**: `fetchSearchHtml(url, cookieHeader)`
- **What it does**:
  - Requests each configured search URL with Axios and includes:
    - a fixed desktop User-Agent
    - `referer: https://www.lancers.jp/mypage`
    - `cookie: <cookieHeader from Playwright>`
  - Returns server-rendered HTML as text.

### 3) Parse jobs from search HTML (Cheerio)

- **Function**: `parseJobsFromSearchHtml(html)`
- **What it extracts (per job card)**:
  - `id`: from the card `onclick` (`goToLjpWorkDetail(<id>)`) or from `/work/detail/<id>` in URL
  - `title`, `url`
  - `desc`: cleaned summary text
  - `category`, `price`, `proposals`, `daysLeft`, `deadline`
  - `employer`, `employerUrl`, `employerAvatar`
  - `workType`

### 4) Scrape loop + cookie refresh logic

- **Loop**: `scrapeJobs()` runs `while (true)` and breaks only when `scraping` is set to `false`.
- **Per iteration**:
  - Picks one URL from `searchUrls` (rotating by iteration).
  - If there is no cookie yet, performs Playwright login to get one.
  - Fetches HTML. If the HTML does not include `"user_id"`, it treats it as “login required” and re-logins to refresh cookies.
  - Parses jobs. If parsing yields 0 jobs, it resets cookie to `null` and retries next iteration.
  - Sends the parsed jobs (reversed) to the job processor:
    - `processScrapedJob(config.ADMIN_ID, jobs.reverse())`
  - Waits `SCRAPE_LOOP_DELAY_MS` (currently 5000ms) and continues.

## Job processing + dedupe + notification formatting

- **File**: `src/job.controller.ts`
- **Model**: `src/models/Job.ts` with schema `{ id: string (unique), bidPlaced: boolean }`.

### Dedupe rule

- For each scraped job:
  - Determine `jobid` from `job.id` or by extracting from the job URL.
  - Upsert into MongoDB with:
    - filter: `{ id: jobid }`
    - update: `{ $setOnInsert: { id: jobid, bidPlaced: false } }`
    - options: `{ upsert: true }`
  - If the upsert inserted a new record (`upsertedCount === 1`), it is treated as a **new job**.
  - Otherwise it is skipped as “already exists”.

### Telegram message content

- If the job is new:
  - Builds an HTML-formatted message including title, category, days left, price, and an “案件ページ” link.
  - Truncates the job description to fit Telegram size limits:
    - **1024 chars** caption limit when sending photo
    - **4096 chars** message limit when sending text
  - Sends via `sendMessage(ADMIN_ID, message, employerAvatar?)`.

## Bid generation / bidding (current status)

- **File**: `src/bidder/index.ts`

### OpenAI bid text generation

- `generateBidText(description)`:
  - Sends a Japanese system prompt for natural bid copy.
  - Uses `openai.chat.completions.create({ model: "gpt-4o", max_tokens: 2000 })`.

### Placing bids

- `placeBid(jobid)` exists, but the actual browser automation steps are currently **commented out** in the checked-in code.
  - If re-enabled, it would open the proposal page and submit the generated bid text.

## “Stop” behavior

- **File**: `src/scraper/index.ts`
- `stopScraping()` sets `scraping = false`. The `scrapeJobs()` loop checks this at the top of the loop and will break.

## Key files at a glance

- `src/index.ts`: startup wiring (DB + bot + scraper)
- `src/config/index.ts`: dotenv + config validation
- `src/db.ts`: MongoDB connection with retry
- `src/bot/index.ts`: Telegraf bot + sendMessage helper
- `src/bot/commands.ts`: Telegram commands (handlers)
- `src/scraper/index.ts`: Lancers login + search scraping loop
- `src/job.controller.ts`: dedupe + message formatting + Telegram notification
- `src/models/Job.ts`: Job schema
- `src/bidder/index.ts`: OpenAI bid text generation; bid placement currently commented out

