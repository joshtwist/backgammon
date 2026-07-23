import { test, expect } from "@playwright/test";
import {
  setupTwoPlayers,
  startTwoPlayerGame,
  playOpening,
  dragMove,
  expectPointCount,
} from "./helpers.ts";

/**
 * Mobile-specific layout guarantees on the iphone project (393×852,
 * touch enabled): the whole board fits, nothing scrolls sideways, and
 * checker dragging works with a touch pointer.
 */
test.describe("Mobile layout", () => {
  test("board fits the phone viewport with no horizontal scroll", async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "iphone", "mobile-only checks");

    const { ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser);
    await startTwoPlayerGame(page1, page2);
    await playOpening(page1, page2, 5, 3);
    await expect(page1.getByTestId("dice-tray")).toBeVisible();

    // All 24 points, the bar, both trays, and the controls are on screen.
    for (const p of [1, 6, 7, 12, 13, 18, 19, 24]) {
      await expect(page1.getByTestId(`point-${p}`)).toBeInViewport();
    }
    await expect(page1.getByTestId("bar")).toBeInViewport();
    await expect(page1.getByTestId("tray-you")).toBeInViewport();
    await expect(page1.getByTestId("confirm-btn")).toBeInViewport();
    await expect(page1.getByTestId("hud-opponent")).toBeInViewport();

    // No horizontal overflow anywhere.
    const fits = await page1.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fits).toBe(true);

    // Touch drag: 13/8 lands and the stack updates.
    await dragMove(page1, 13, 8);
    await expectPointCount(page1, 8, 4);
    await expectPointCount(page1, 13, 4);

    await ctx1.close();
    await ctx2.close();
  });
});
