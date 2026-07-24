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
  expectSameBoard,
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

    // Mid-drag, the box under the pointer is "armed"; releasing over a
    // dead zone (the bar strip) stages nothing and the checker returns.
    const src = (await page1.getByTestId("top-13").boundingBox())!;
    const p8 = (await page1.getByTestId("point-8").boundingBox())!;
    const bar = (await page1.getByTestId("bar").boundingBox())!;
    await page1.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page1.mouse.down();
    await page1.mouse.move(p8.x + p8.width / 2, p8.y + p8.height / 2, {
      steps: 10,
    });
    await expect(page1.getByTestId("armed-8")).toBeVisible();
    await page1.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2, {
      steps: 10,
    });
    await expect(page1.getByTestId("armed-8")).toHaveCount(0);
    await page1.mouse.up();
    await expectPointCount(page1, 13, 5);
    await expectPointCount(page1, 8, 3);

    // Play 13/8 13/10 and confirm
    await dragMove(page1, 13, 8);
    await expectPointCount(page1, 8, 4);
    await dragMove(page1, 13, 10);
    await expectPointCount(page1, 10, 1);
    await expectPointCount(page1, 13, 3);
    await confirmTurn(page1);

    // Both players see the SAME board now — white's move shows at the same
    // (absolute) points on both screens, not mirrored.
    await expect(page2.getByTestId("roll-btn")).toBeVisible();
    await expectPointCount(page2, 8, 4);
    await expectPointCount(page2, 10, 1);
    await expectSameBoard(page1, page2, [1, 6, 8, 10, 12, 13, 17, 19, 24]);
    await expect(page2.getByTestId("info-line")).toContainText("13/8");

    // Black plays (in the shared frame) 1/7 12/14 — black's own 24/18 13/11
    // with a forced 6-2. Both players get the center dice-reveal theater.
    await rollAs(page2, 6, 2);
    await expect(page2.getByTestId("dice-reveal")).toBeVisible();
    await expect(page1.getByTestId("dice-reveal")).toBeVisible();
    // ...and it fades away on its own after the hold (~2.35s + fade).
    await expect(page1.getByTestId("dice-reveal")).toHaveCount(0, {
      timeout: 7_000,
    });
    await dragMove(page2, 1, 7); // black's back checker, 6
    await dragMove(page2, 12, 14); // black's midpoint, 2
    await confirmTurn(page2);

    // White sees black's checkers land at those same absolute points.
    await expectSameBoard(page1, page2, [1, 7, 12, 14, 19, 24]);

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

  test("flip-board toggle rotates the board and keeps dragging working", async ({
    browser,
  }) => {
    const { ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser);
    const { gameUrl } = await createGame(page1);
    await joinAs(page1, "Josh", "rocket");
    await page2.goto(gameUrl);
    await joinAs(page2, "Anna", "cat");
    await page1.getByTestId("start-game-btn").click();
    await playOpening(page1, page2, 5, 3); // white (page1) to move

    // Flip only affects the local view — page2 is unchanged.
    await page1.getByTestId("flip-board-btn").click();
    const field = page1.locator('[data-testid="point-1"]').locator("..");
    await expect(field).toHaveCSS("transform", /matrix\(-1, 0, 0, -1/);

    // Dragging still lands correctly despite the 180° rotation (hit-test
    // un-rotates the pointer): white plays 13/8 (5) and 13/10 (3).
    await dragMove(page1, 13, 8);
    await expectPointCount(page1, 8, 4);
    await dragMove(page1, 13, 10);
    await expectPointCount(page1, 10, 1);
    await confirmTurn(page1);
    await expectPointCount(page2, 8, 4);
    await expectPointCount(page2, 10, 1);

    // Preference persists across a reload.
    await page1.reload();
    await expect(page1.getByTestId("flip-board-btn")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await ctx1.close();
    await ctx2.close();
  });

  test("opponent sees staged moves live, with a green glow, and undo syncs", async ({
    browser,
  }) => {
    const { ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser);
    const { gameUrl } = await createGame(page1);
    await joinAs(page1, "Josh", "rocket");
    await page2.goto(gameUrl);
    await joinAs(page2, "Anna", "cat");
    await page1.getByTestId("start-game-btn").click();
    await playOpening(page1, page2, 5, 3); // white (page1) to move

    // White stages a move WITHOUT confirming.
    await dragMove(page1, 13, 8);

    // Anna (watching) sees the checker move live and the landing point
    // glowing green — before any confirm.
    await expectPointCount(page2, 8, 4);
    await expect(page2.getByTestId("preview-8")).toBeVisible();

    // White undoes — Anna's view reverts in sync.
    await page1.getByTestId("undo-btn").click();
    await expectPointCount(page2, 8, 3);
    await expect(page2.getByTestId("preview-8")).toHaveCount(0);

    await ctx1.close();
    await ctx2.close();
  });
});
