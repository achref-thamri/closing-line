/**
 * Regenerates the README images from demo data, never from real chats or bets:
 *   pnpm --filter @closing-line/web build && pnpm --filter @closing-line/web start --port 3100   (demo mode)
 *   node apps/worker/scripts/screenshots.ts
 * - docs/images/dashboard-demo.png: the top of the dashboard as served on port 3100.
 * - docs/images/telegram-tip.png and telegram-log.png: the bot's own message texts and buttons (formatTip and
 *   tipKeyboard for a made-up tip; BetFlow answering a /log conversation on an in-memory database), drawn as chat
 *   bubbles.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfig } from "@closing-line/config";
import { createRepositories, openDatabase } from "@closing-line/db";
import { chromium } from "@playwright/test";
import { BetFlow } from "../src/app/betFlow.ts";
import { Bettors } from "../src/app/bettors.ts";
import type { Keyboard, Reply } from "../src/app/chat.ts";
import { formatTip, tipKeyboard, type Tip } from "../src/app/tips.ts";
import { silentLogger } from "../src/lib/logger.ts";

const images = join(fileURLToPath(new URL(".", import.meta.url)), "../../../docs/images");
const OWNER = 1;

interface Message {
    from: "bettor" | "bot";
    text: string;
    keyboard?: Keyboard | undefined;
}

const tip: Tip = {
    fixtureId: "f".repeat(32),
    selection: "away",
    homeTeam: "Hull City",
    awayTeam: "Watford",
    kickoff: new Date("2026-11-07T15:00:00Z"),
    pick: "Watford",
    fairOdds: 2.97,
    offers: [
        { bookmaker: "unibet_se", offeredOdds: 3.1, netOdds: 3.1, edge: 0.044 },
        { bookmaker: "nordicbet", offeredOdds: 3.05, netOdds: 3.05, edge: 0.027 },
    ],
    paperStakeKr: 50,
    seenAt: new Date("2026-11-07T08:02:00Z"),
};

/** A /log conversation as the real bet flow answers it. */
async function logConversation(): Promise<Message[]> {
    const handle = await openDatabase({ kind: "pglite" });
    const repos = createRepositories(handle.db);
    const config = parseConfig({
        ODDS_API_KEY: "demo",
        FOOTBALL_DATA_TOKEN: "demo",
        TELEGRAM_BOT_TOKEN: "1:demo",
        TELEGRAM_OWNER_CHAT_ID: String(OWNER),
    });
    const messenger = { send: () => Promise.resolve() };
    const now = () => new Date("2026-11-07T13:40:00Z");
    const bettors = new Bettors({ repos, config, messenger, now });
    const flow = new BetFlow({ repos, bettors, config, messenger, logger: silentLogger, now });

    const messages: Message[] = [];
    let last: Reply = { text: "" };
    const bot = (reply: Reply) => {
        last = reply;
        messages.push({ from: "bot", text: reply.text, keyboard: reply.keyboard });
    };
    const tap = async (label: string) => {
        const button = last.keyboard?.flat().find((each) => each.text.includes(label));
        if (!button) throw new Error(`no ${label} button`);
        messages.push({ from: "bettor", text: `[${button.text}]` });
        bot(await flow.tap(OWNER, button.data));
    };
    const type = async (text: string) => {
        messages.push({ from: "bettor", text });
        const [reply] = await flow.text(OWNER, text);
        if (reply) bot(reply);
    };

    messages.push({ from: "bettor", text: "/log" });
    bot(await flow.bet(OWNER));
    await tap("Football");
    await type("Arsenal – Chelsea");
    await tap("Shots on target");
    await type("Saka");
    await tap("Over 0.5");
    await tap("Bet25");
    await type("1.85");
    await type("500");
    await tap("Lineup");
    await handle.close();
    return messages;
}

function escape(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Chat bubbles in a neutral style, with inline buttons under the bot's messages. */
function chat(title: string, messages: Message[]): string {
    const bubbles = messages
        .map((message) => {
            const buttons = (message.keyboard ?? [])
                .map((row) => `<div class="row">${row.map((b) => `<span>${escape(b.text)}</span>`).join("")}</div>`)
                .join("");
            return `<div class="msg ${message.from}"><div class="bubble">${escape(message.text)}</div>${
                buttons ? `<div class="keys">${buttons}</div>` : ""
            }</div>`;
        })
        .join("");
    return `<!doctype html><meta charset="utf-8"><style>
        body { margin: 0; background: #e8edf2; font: 15px/1.4 -apple-system, "Segoe UI", sans-serif; }
        header { background: #fff; padding: 12px 16px; font-weight: 600; border-bottom: 1px solid #d0d7de; }
        main { padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 8px; width: 420px; }
        .msg { display: flex; flex-direction: column; max-width: 85%; }
        .msg.bot { align-self: flex-start; }
        .msg.bettor { align-self: flex-end; align-items: flex-end; }
        .bubble { white-space: pre-wrap; padding: 8px 12px; border-radius: 12px; background: #fff; }
        .bettor .bubble { background: #d9f2c4; }
        .keys { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
        .row { display: flex; gap: 4px; }
        .row span { flex: 1; text-align: center; background: rgba(255,255,255,.75); border-radius: 8px;
            padding: 6px 8px; font-size: 13px; color: #2b6cb0; }
    </style><header>${escape(title)}</header><main>${bubbles}</main>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });

// The top of the page: leaderboard, chart and the first bets, wide enough for every column of the table.
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto("http://localhost:3100");
await page.getByTestId("bankroll-chart").locator("svg").first().waitFor();
await page.screenshot({ path: join(images, "dashboard-demo.png") });

await page.setViewportSize({ width: 452, height: 400 });
const tipText = formatTip(tip, "Europe/Copenhagen") ?? "";
await page.setContent(chat("Closing Line (example tip)", [{ from: "bot", text: tipText, keyboard: tipKeyboard(tip) }]));
await page.locator("main").screenshot({ path: join(images, "telegram-tip.png") });

await page.setContent(chat("Closing Line (example /log)", await logConversation()));
await page.locator("main").screenshot({ path: join(images, "telegram-log.png") });

await browser.close();
console.log("wrote dashboard-demo.png, telegram-tip.png and telegram-log.png");
