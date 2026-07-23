import { test } from "@playwright/test";
import {
  setupTwoPlayers,
  startTwoPlayerGame,
  playOpening,
  setPosition,
  board,
  forceRolls,
  dragMove,
  confirmTurn,
} from "./helpers.ts";

/**
 * Visual capture of the mobile game surface. Not an assertion test —
 * produces screenshots for eyeballing layout during development.
 */
test.describe("screenshots", () => {
  test("capture lobby, opening and board", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "iphone", "visual capture is mobile-only");
    const { ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser);

    await startTwoPlayerGame(page1, page2);
    await page1.screenshot({ path: "test-results/shots/opening.png" });

    await playOpening(page1, page2, 5, 3);
    await page1.waitForSelector('[data-testid="dice-tray"]');
    // Catch the dice reveal mid-hold on the non-roller's screen
    await page1.waitForTimeout(500);
    await page2.screenshot({ path: "test-results/shots/dice-reveal.png" });
    await page1.waitForTimeout(1400); // reveal docks + pop-ins settle
    await page1.screenshot({ path: "test-results/shots/board-white-to-move.png" });
    await page2.screenshot({ path: "test-results/shots/board-black-waiting.png" });

    // Mid-game scene: white on the bar, mid-staging after re-entry
    await setPosition(
      page1,
      board(
        { 25: 1, 13: 4, 8: 3, 6: 4, 4: 2, 0: 1 },
        { 20: 2, 13: 4, 8: 3, 6: 4, 24: 1, 0: 1 },
      ),
      "white",
    );
    await forceRolls(page1, [4, 2]);
    await page1.getByTestId("roll-btn").click();
    await dragMove(page1, 25, 21);
    await page1.waitForTimeout(700);
    await page1.screenshot({ path: "test-results/shots/mid-staging.png" });

    // Impatience nudge: sit on the roll for 5+ seconds
    await setPosition(
      page1,
      board({ 13: 5, 8: 5, 6: 5 }, { 13: 5, 8: 5, 6: 5 }),
      "white",
    );
    await page1.waitForSelector('[data-testid="roll-btn"]');
    await page1.waitForTimeout(5600);
    await page1.screenshot({ path: "test-results/shots/impatience-roller.png" });
    await page2.screenshot({ path: "test-results/shots/impatience-waiter.png" });

    // Win screen
    await setPosition(page1, board({ 2: 1, 1: 1 }, { 6: 15 }), "white");
    await forceRolls(page1, [2, 1]);
    await page1.getByTestId("roll-btn").click();
    await dragMove(page1, 2, "off");
    await dragMove(page1, 1, "off");
    await confirmTurn(page1);
    await page1.waitForSelector('[data-testid="winner-banner"]');
    await page1.waitForTimeout(1000);
    await page1.screenshot({ path: "test-results/shots/win-screen.png" });

    await ctx1.close();
    await ctx2.close();
  });
});
