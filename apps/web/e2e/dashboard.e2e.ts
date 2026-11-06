import { expect, test } from "@playwright/test";

test("shows the leaderboard, the bankroll chart and the latest bets", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Closing Line" })).toBeVisible();
    await expect(page.getByText("Demo data")).toBeVisible();

    const cards = page.getByTestId("player-card");
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText("#1");
    await expect(page.getByRole("region", { name: "Leaderboard" })).toContainText("Value scanner");

    await expect(page.getByTestId("bankroll-chart").locator("svg").first()).toBeVisible();
    await expect(page.getByTestId("bankroll-chart").locator(".recharts-line")).toHaveCount(3);

    const rows = page.getByTestId("bet-row");
    await expect(rows).toHaveCount(50);
    // Open bets come first under a heading per kickoff day.
    await expect(page.getByTestId("bets-table").locator("tbody th").first()).toHaveText(
        /^(Waiting for a result|Today · |Tomorrow · |\w{3} \d+ \w{3}$)/,
    );
    await expect(page.getByTestId("bet-counts")).toContainText("showing 1–50");
});

test("pages through the bets, 50 at a time", async ({ page }) => {
    await page.goto("/");
    const pages = page.getByRole("navigation", { name: "Bet pages" });
    await expect(pages).toContainText("Page 1 of");

    await pages.getByRole("link", { name: "Next →" }).click();
    await expect(page).toHaveURL(/\?page=2#bets$/);
    await expect(pages).toContainText("Page 2 of");
    await expect(page.getByTestId("bet-counts")).toContainText("showing 51–");

    await pages.getByRole("link", { name: "← Previous" }).click();
    await expect(pages).toContainText("Page 1 of");
});

test("shows one player's bets and keeps the choice when paging", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Show bets of" }).getByRole("link", { name: "Value scanner" }).click();
    await expect(page).toHaveURL(/\?player=scanner#bets$/);

    const players = page.getByTestId("bet-row").locator("td:nth-child(2)");
    await expect(players.first()).toHaveText("Value scanner");
    expect(new Set(await players.allTextContents())).toEqual(new Set(["Value scanner"]));

    const next = page.getByRole("navigation", { name: "Bet pages" }).getByRole("link", { name: "Next →" });
    if ((await next.count()) > 0) {
        await next.click();
        await expect(page).toHaveURL(/\?player=scanner&page=2#bets$/);
    }
});

test("has no horizontal scroll on the page itself", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});
