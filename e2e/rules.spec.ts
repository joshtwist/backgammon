import { test, expect } from "@playwright/test";
import {
  setupTwoPlayers,
  startTwoPlayerGame,
  playOpening,
  forceRolls,
  setPosition,
  board,
  dragMove,
  confirmTurn,
  expectPointCount,
} from "./helpers.ts";

/**
 * Rules enforcement seen through the UI, using the TEST_HOOKS position
 * and dice injection. The engine itself is unit-tested exhaustively;
 * these tests pin the server/client integration of the nasty rules.
 */
test.describe("Rules through the UI", () => {
  test("a dance shows the banner and auto-passes the turn", async ({
    browser,
  }) => {
    const { ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser);
    await startTwoPlayerGame(page1, page2);
    await playOpening(page1, page2, 5, 3);

    // White stuck on the bar, both entry points (22 via 3, 20 via 5) blocked.
    await setPosition(
      page1,
      board(
        { 25: 1, 6: 5, 5: 5, 4: 4 },
        { 3: 2, 5: 2, 6: 6, 13: 5 },
      ),
      "white",
    );
    await forceRolls(page1, [3, 5]);
    await page1.getByTestId("roll-btn").click();

    // Both players see the dance banner, then the turn flips to black.
    await expect(page1.getByTestId("dance-banner")).toBeVisible();
    await expect(page2.getByTestId("dance-banner")).toBeVisible();
    await expect(page2.getByTestId("roll-btn")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page2.getByTestId("info-line")).toContainText("no moves");

    await ctx1.close();
    await ctx2.close();
  });

  test("when only one die can be played, the higher is forced", async ({
    browser,
  }) => {
    const { ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser);
    await startTwoPlayerGame(page1, page2);
    await playOpening(page1, page2, 5, 3);

    // Only white's back checker can move; 18 and 19 open but 13 blocked:
    // either die playable alone, never both → the 6 is forced.
    await setPosition(
      page1,
      board(
        { 24: 1, 3: 5, 2: 5, 1: 4 },
        { 12: 2, 5: 3, 4: 3, 3: 3, 2: 4 },
      ),
      "white",
    );
    await forceRolls(page1, [6, 5]);
    await page1.getByTestId("roll-btn").click();

    await expect(page1.getByTestId("info-line")).toContainText(
      "must play the 6",
    );

    // Dragging to the 5-destination (19) is rejected: not a legal target.
    await dragMove(page1, 24, 19);
    await expectPointCount(page1, 19, 0);
    await expectPointCount(page1, 24, 1);

    // The 6 (24/18) works and completes the turn (maxPlayable = 1).
    await dragMove(page1, 24, 18);
    await expectPointCount(page1, 18, 1);
    await confirmTurn(page1);
    await expect(page2.getByTestId("roll-btn")).toBeVisible();

    await ctx1.close();
    await ctx2.close();
  });

  test("hits send checkers to the bar; entry from the bar can counter-hit", async ({
    browser,
  }) => {
    const { ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser);
    await startTwoPlayerGame(page1, page2);
    await playOpening(page1, page2, 5, 3);

    // White blot on white's 20 (= black's 5). Black to roll 3-4.
    await setPosition(
      page1,
      board(
        { 20: 1, 13: 1, 6: 5, 5: 4, 4: 4 },
        { 8: 3, 6: 5, 13: 5, 24: 2 },
      ),
      "black",
    );
    await forceRolls(page2, [3, 4]);
    await page2.getByTestId("roll-btn").click();

    // Black hits with 8/5* then plays 8/4 (own numbering). In the shared
    // white frame those are 17/20* and 17/21.
    await dragMove(page2, 17, 20);
    await dragMove(page2, 17, 21);
    await confirmTurn(page2);

    // White is on the bar (bar badge on white's own page).
    await expect(page1.getByTestId("bar")).toHaveAttribute(
      "data-count-you",
      "1",
    );
    // ...and the victim gets a reaction GIF for being hit.
    await expect(page1.getByTestId("hit-gif")).toBeVisible();
    await expect(page1.getByTestId("roll-btn")).toBeVisible();

    // White enters with the 5 onto 20 — hitting black's blot right back.
    await forceRolls(page1, [5, 2]);
    await page1.getByTestId("roll-btn").click();
    await dragMove(page1, 25, 20);
    await expectPointCount(page1, 20, 1);
    // ...and plays the 2 elsewhere (13/11), then confirms.
    await dragMove(page1, 13, 11);
    await confirmTurn(page1);

    // Now BLACK is on the bar, seen from black's own page.
    await expect(page2.getByTestId("bar")).toHaveAttribute(
      "data-count-you",
      "1",
    );

    await ctx1.close();
    await ctx2.close();
  });
});
