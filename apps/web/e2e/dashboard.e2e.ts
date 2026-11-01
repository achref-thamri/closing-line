import { expect, test } from "@playwright/test";

test("shows the leaderboard, the bankroll chart and the latest bets", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Betting Bot" })).toBeVisible();
    await expect(page.getByText("Demo data")).toBeVisible();

    const cards = page.getByTestId("player-card");
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText("#1");
    await expect(page.getByRole("region", { name: "Leaderboard" })).toContainText("Value scanner");

    await expect(page.getByTestId("bankroll-chart").locator("svg").first()).toBeVisible();
    await expect(page.getByTestId("bankroll-chart").locator(".recharts-line")).toHaveCount(3);

    const rows = page.getByTestId("bets-table").locator("tbody tr");
    await expect(rows).toHaveCount(50);
});

test("has no horizontal scroll on the page itself", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});
