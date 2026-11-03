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

    const rows = page.getByTestId("bets-table").locator("tbody tr");
    await expect(rows).toHaveCount(50);
    await expect(page.getByTestId("bet-counts")).toContainText("showing 1–50");
});

test("pages through the bets, 50 at a time", async ({ page }) => {
    await page.goto("/");
    const pages = page.getByRole("navigation", { name: "Bet pages" });
    await expect(pages).toContainText("Page 1 of");

    await pages.getByRole("link", { name: "Older →" }).click();
    await expect(page).toHaveURL(/\?page=2$/);
    await expect(pages).toContainText("Page 2 of");
    await expect(page.getByTestId("bet-counts")).toContainText("showing 51–");

    await pages.getByRole("link", { name: "← Newer" }).click();
    await expect(pages).toContainText("Page 1 of");
});

test("has no horizontal scroll on the page itself", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});
