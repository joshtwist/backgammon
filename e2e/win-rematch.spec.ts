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
} from "./helpers.ts";

/**
 * Bear-off → gammon win → rematch → series score carries → second game
 * won by the other player accumulates onto the carried score.
 */
test("gammon win, rematch with carried series, second game accumulates", async ({
  browser,
}) => {
  const { ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser);
  await startTwoPlayerGame(page1, page2);
  await playOpening(page1, page2, 5, 3);

  // ── Game 1: white two checkers from victory; black has borne off
  // nothing and sits outside white's home → gammon (2 points).
  await setPosition(
    page1,
    board({ 2: 1, 1: 1 }, { 6: 15 }),
    "white",
  );
  await forceRolls(page1, [2, 1]);
  await page1.getByTestId("roll-btn").click();

  await dragMove(page1, 2, "off");
  await dragMove(page1, 1, "off");
  await confirmTurn(page1);

  // Winner + kind + points on both screens
  await expect(page1.getByTestId("winner-banner")).toHaveText("You Won!");
  await expect(page2.getByTestId("winner-banner")).toHaveText("Josh Wins!");
  await expect(page1.getByTestId("win-kind")).toContainText("Gammon");
  await expect(page1.getByTestId("win-kind")).toContainText("2 points");
  await expect(page1.getByTestId("series-score-Josh")).toHaveText("2");
  await expect(page1.getByTestId("series-score-Anna")).toHaveText("0");

  // ── Rematch: creator auto-navigates; the other player follows.
  const game1Url = page1.url();
  await page1.getByTestId("create-rematch-btn").click();
  await page1.waitForURL((url) => url.toString() !== game1Url, {
    timeout: 10_000,
  });
  await expect(page1.getByTestId("lobby-player-Josh")).toBeVisible({
    timeout: 10_000,
  });

  await page2.getByTestId("join-rematch-btn").click();
  await expect(page2.getByTestId("lobby-player-Anna")).toBeVisible({
    timeout: 10_000,
  });

  // The carried series shows in both lobbies.
  await expect(page1.getByTestId("series-banner")).toContainText("Josh 2 – 0 Anna");
  await expect(page2.getByTestId("series-banner")).toContainText("Josh 2 – 0 Anna");

  // ── Game 2: Anna (black) wins a single game → 2–1.
  await page1.getByTestId("start-game-btn").click();
  await playOpening(page1, page2, 5, 3);

  // Black one checker from home; white already has one borne off → single.
  await setPosition(
    page1,
    board({ 0: 1, 6: 14 }, { 1: 1 }),
    "black",
  );
  await forceRolls(page2, [1, 3]);
  await page2.getByTestId("roll-btn").click();
  await dragMove(page2, 1, "off");
  await confirmTurn(page2);

  await expect(page2.getByTestId("winner-banner")).toHaveText("You Won!");
  await expect(page1.getByTestId("winner-banner")).toHaveText("Anna Wins!");
  await expect(page1.getByTestId("win-kind")).toContainText("1 point");
  await expect(page1.getByTestId("series-score-Josh")).toHaveText("2");
  await expect(page1.getByTestId("series-score-Anna")).toHaveText("1");
  await expect(page1.getByTestId("series-scores")).toContainText("2 games");

  await ctx1.close();
  await ctx2.close();
});
