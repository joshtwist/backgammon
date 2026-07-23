import { test, expect } from "@playwright/test";
import {
  setupTwoPlayers,
  createGame,
  joinAs,
  forceRolls,
  playOpening,
  rollAs,
  dragMove,
  confirmTurn,
  expectPointCount,
} from "./helpers.ts";

test.describe("Two-player game flow", () => {
  test("invite, join, opening roll (with a tie), moves, undo, turn alternation", async ({
    browser,
  }) => {
    const { ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser);

    // P1 creates and joins
    const { gameUrl } = await createGame(page1);
    await joinAs(page1, "Josh", "rocket");

    // P2 opens the invite URL: taken icon is disabled
    await page2.goto(gameUrl);
    await expect(page2.getByTestId("icon-rocket")).toBeDisabled();
    await joinAs(page2, "Anna", "cat");

    // Both lobbies show both players; only the creator can start
    await expect(page1.getByTestId("lobby-player-Anna")).toBeVisible();
    await expect(page2.getByTestId("lobby-player-Josh")).toBeVisible();
    await expect(page2.getByTestId("start-game-btn")).toHaveCount(0);

    await page1.getByTestId("start-game-btn").click();
    await expect(page1.getByTestId("opening-roll-btn")).toBeVisible();
    await expect(page2.getByTestId("opening-roll-btn")).toBeVisible();

    // Opening tie: both roll 4 → banner + re-armed dice
    await forceRolls(page1, [4, 4]);
    await page1.getByTestId("opening-roll-btn").click();
    await expect(page1.getByTestId("opening-die-you")).toBeVisible();
    await page2.getByTestId("opening-roll-btn").click();
    await expect(page1.getByTestId("opening-tie")).toBeVisible();
    await expect(page2.getByTestId("opening-tie")).toBeVisible();
    await expect(page1.getByTestId("opening-roll-btn")).toBeVisible();

    // Re-roll: white 5, black 3 → white (P1) moves first with 5-3
    await playOpening(page1, page2, 5, 3);
    await expect(page1.getByTestId("dice-tray")).toBeVisible();
    await expect(page1.getByTestId("info-line")).toContainText(
      "won the opening",
    );
    await expect(page2.getByTestId("turn-status")).toContainText("is moving");

    // Stage a move, then undo it
    await dragMove(page1, 6, 3); // 6/3 with the 3
    await expectPointCount(page1, 3, 1);
    await page1.getByTestId("undo-btn").click();
    await expectPointCount(page1, 3, 0);
    await expectPointCount(page1, 6, 5);

    // Play 13/8 13/10 and confirm
    await dragMove(page1, 13, 8);
    await expectPointCount(page1, 8, 4);
    await dragMove(page1, 13, 10);
    await expectPointCount(page1, 10, 1);
    await expectPointCount(page1, 13, 3);
    await confirmTurn(page1);

    // Black's turn: P2 gets the roll button and sees white's move
    // (white's 8 is black's 17) plus the move recap.
    await expect(page2.getByTestId("roll-btn")).toBeVisible();
    await expectPointCount(page2, 17, 4);
    await expect(page2.getByTestId("info-line")).toContainText("13/8");

    // Black plays 24/18 13/11 with a forced 6-2
    await rollAs(page2, 6, 2);
    await dragMove(page2, 24, 18);
    await dragMove(page2, 13, 11);
    await confirmTurn(page2);

    // Back to white
    await expect(page1.getByTestId("roll-btn")).toBeVisible();
    await expect(page1.getByTestId("info-line")).toContainText("Anna");

    await ctx1.close();
    await ctx2.close();
  });

  test("a returning player reconnects into the live game", async ({
    browser,
  }) => {
    const { ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser);
    const { gameUrl } = await createGame(page1);
    await joinAs(page1, "Josh", "rocket");
    await page2.goto(gameUrl);
    await joinAs(page2, "Anna", "cat");
    await page1.getByTestId("start-game-btn").click();
    await playOpening(page1, page2, 5, 3);
    await expect(page1.getByTestId("dice-tray")).toBeVisible();

    // Reload mid-turn: same player lands straight back on the board
    await page1.reload();
    await expect(page1.getByTestId("dice-tray")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page1.getByTestId("name-input")).toHaveCount(0);
    await expectPointCount(page1, 13, 5);

    // The opponent saw the disconnect+reconnect without state loss
    await expect(page2.getByTestId("turn-status")).toContainText("is moving");

    await ctx1.close();
    await ctx2.close();
  });
});
