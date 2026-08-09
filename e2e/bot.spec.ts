import { expect, test } from "@playwright/test";
import {
  attachErrorLogging,
  board,
  createGame,
  forceRolls,
  joinAs,
  setPosition,
} from "./helpers.ts";

/**
 * Playing against the computer. Unlike the two-player specs there's only
 * one browser: the second seat is filled by the server-driven bot, whose
 * turns arrive on their own via the Durable Object's alarm.
 */
test.describe("Computer opponent", () => {
  test("add a computer, start, and it plays its own turns", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachErrorLogging(page, "P1");

    await createGame(page);
    await joinAs(page, "Josh", "rocket");

    // The empty seat offers the computer.
    await page.getByTestId("add-bot-btn").click();
    await expect(page.getByTestId("lobby-player-Computer")).toBeVisible();

    // Two players now — the host can start.
    await page.getByTestId("start-game-btn").click();
    await expect(page.getByTestId("opening-roll-btn")).toBeVisible();

    // Human rolls a 6, computer will roll 2 → human (white) opens.
    await forceRolls(page, [6, 2]);
    await page.getByTestId("opening-roll-btn").click();

    // The computer taps its own opening die without any input from us.
    await expect(page.getByTestId("confirm-btn")).toBeVisible({
      timeout: 10_000,
    });

    await ctx.close();
  });

  test("difficulty can be chosen and is shown on the opponent", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachErrorLogging(page, "P1");

    await createGame(page);
    await joinAs(page, "Josh", "rocket");

    // Medium is the default; switch to Hard before seating the computer.
    await expect(page.getByTestId("difficulty-medium")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByTestId("difficulty-hard").click();
    await page.getByTestId("add-bot-btn").click();

    await expect(page.getByTestId("bot-difficulty")).toHaveText("(Hard)");

    // The label follows through into the game.
    await page.getByTestId("start-game-btn").click();
    await expect(page.getByTestId("opening-roll-btn")).toBeVisible();
    await forceRolls(page, [6, 2]);
    await page.getByTestId("opening-roll-btn").click();
    await expect(page.getByTestId("hud-opponent")).toContainText("(Hard)", {
      timeout: 10_000,
    });

    await ctx.close();
  });

  test("the computer takes its turn after the human confirms", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachErrorLogging(page, "P1");

    await createGame(page);
    await joinAs(page, "Josh", "rocket");
    await page.getByTestId("add-bot-btn").click();
    await page.getByTestId("start-game-btn").click();
    await expect(page.getByTestId("opening-roll-btn")).toBeVisible();

    await forceRolls(page, [6, 2]);
    await page.getByTestId("opening-roll-btn").click();
    await expect(page.getByTestId("confirm-btn")).toBeVisible({
      timeout: 10_000,
    });

    // Hand the computer (black) a simple race position where it's on roll,
    // then watch it roll and move entirely on its own.
    await setPosition(
      page,
      board({ 6: 2, 5: 2, 4: 2, 3: 2, 2: 2, 1: 5 }, { 6: 5, 5: 5, 4: 5 }),
      "black",
    );

    // Its pip count must drop once it has played — proof it moved itself.
    const hud = page.getByTestId("hud-opponent");
    const before = await hud.textContent();
    await expect
      .poll(async () => hud.textContent(), { timeout: 20_000 })
      .not.toBe(before);

    await ctx.close();
  });
});
