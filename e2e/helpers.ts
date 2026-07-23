import { expect, type Page, type BrowserContext } from "@playwright/test";
import type { BoardState, Color, Die, PlayerIcon } from "../src/shared/types.ts";
import { side } from "../src/shared/engine/testkit.ts";

/**
 * Shared helpers for two-player game tests.
 *
 * Determinism comes from two TEST_HOOKS-gated server messages sent over
 * the page's live WebSocket (exposed as window.__ws in dev builds):
 *   _test_force_rolls  — queue the next die values the server will roll
 *   _test_set_position — swap in a board and hand the roll to a color
 */

/** Create a fresh game via the homepage and return its game ID + URL. */
export async function createGame(page: Page): Promise<{
  gameId: string;
  gameUrl: string;
}> {
  await page.goto("/");
  await page.getByTestId("create-game-btn").click();
  await page.waitForURL(/\/[a-z0-9]{4,8}$/, { timeout: 10_000 });
  const gameUrl = page.url();
  const gameId = new URL(gameUrl).pathname.slice(1);
  return { gameId, gameUrl };
}

/** Fill in the join form and submit. */
export async function joinAs(
  page: Page,
  name: string,
  icon: PlayerIcon,
): Promise<void> {
  await page.getByTestId("name-input").fill(name);
  await page.getByTestId(`icon-${icon}`).click();
  await page.getByTestId("join-btn").click();
  await expect(page.getByTestId(`lobby-player-${name}`)).toBeVisible({
    timeout: 5_000,
  });
}

/**
 * Standard two-player game setup: P1 creates and joins as Josh (white,
 * creator), P2 opens the invite URL and joins as Anna (black), P1 starts.
 * Ends on the opening-roll screen for both.
 */
export async function startTwoPlayerGame(
  page1: Page,
  page2: Page,
): Promise<{ gameId: string; gameUrl: string }> {
  const { gameId, gameUrl } = await createGame(page1);
  await joinAs(page1, "Josh", "rocket");

  await page2.goto(gameUrl);
  await joinAs(page2, "Anna", "cat");

  await expect(page1.getByTestId("lobby-player-Anna")).toBeVisible();
  await page1.getByTestId("start-game-btn").click();
  await expect(page1.getByTestId("opening-roll-btn")).toBeVisible();
  await expect(page2.getByTestId("opening-roll-btn")).toBeVisible();
  return { gameId, gameUrl };
}

/** Send a raw message over the page's live game WebSocket. */
export async function sendWs(page: Page, msg: unknown): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __ws?: WebSocket }).__ws?.readyState ===
      WebSocket.OPEN,
    undefined,
    { timeout: 5_000 },
  );
  await page.evaluate((m) => {
    (window as unknown as { __ws: WebSocket }).__ws.send(JSON.stringify(m));
  }, msg);
}

/** Queue the next die values the server will roll (TEST_HOOKS only). */
export async function forceRolls(page: Page, rolls: Die[]): Promise<void> {
  await sendWs(page, { type: "_test_force_rolls", rolls });
}

/** Sparse position builder mirroring the unit tests' testkit. */
export function board(
  white: Record<number, number>,
  black: Record<number, number>,
): BoardState {
  return { white: side(white), black: side(black) };
}

/** Swap in a board position and give `turnColor` the roll (TEST_HOOKS only). */
export async function setPosition(
  page: Page,
  boardState: BoardState,
  turnColor: Color,
): Promise<void> {
  await sendWs(page, {
    type: "_test_set_position",
    board: boardState,
    turnColor,
  });
}

/**
 * Play the opening deterministically. P1 joined first, so P1 is white.
 * The forced-roll queue is FIFO: white taps first and consumes die #1.
 */
export async function playOpening(
  pageWhite: Page,
  pageBlack: Page,
  whiteDie: Die,
  blackDie: Die,
): Promise<void> {
  await forceRolls(pageWhite, [whiteDie, blackDie]);
  await pageWhite.getByTestId("opening-roll-btn").click();
  await expect(pageWhite.getByTestId("opening-die-you")).toBeVisible();
  await pageBlack.getByTestId("opening-roll-btn").click();
}

/** Force the dice, then tap Roll on the active player's page. */
export async function rollAs(page: Page, d1: Die, d2: Die): Promise<void> {
  await forceRolls(page, [d1, d2]);
  await page.getByTestId("roll-btn").click();
}

/**
 * Drag the top checker of `from` (viewer's numbering; 25 = bar) onto a
 * target point (or "off" for the bear-off tray).
 *
 * Uses explicit mouse moves with several steps rather than dragTo:
 * framer-motion only enters its drag gesture after real pointer
 * movement, and dragTo's single-step jump sometimes reads as a tap.
 */
export async function dragMove(
  page: Page,
  from: number,
  to: number | "off",
): Promise<void> {
  const source = page.getByTestId(`top-${from}`);
  const target =
    to === "off" ? page.getByTestId("tray-you") : page.getByTestId(`point-${to}`);

  const src = await source.boundingBox();
  const dst = await target.boundingBox();
  if (!src || !dst) throw new Error(`dragMove: missing element ${from}→${to}`);

  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    dst.x + dst.width / 2,
    dst.y + dst.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
}

/** Confirm the staged turn. */
export async function confirmTurn(page: Page): Promise<void> {
  const btn = page.getByTestId("confirm-btn");
  await expect(btn).toBeEnabled();
  await btn.click();
}

/** Assert a point's stack (viewer's numbering) has `count` checkers. */
export async function expectPointCount(
  page: Page,
  point: number,
  count: number,
): Promise<void> {
  await expect(page.getByTestId(`point-${point}`)).toHaveAttribute(
    "data-count",
    String(count),
  );
}

/** Attach error logging so failures surface console errors. */
export function attachErrorLogging(page: Page, label: string): void {
  page.on("pageerror", (err) => {
    console.log(`[${label} pageerror]`, err.message);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log(`[${label} console]`, msg.text());
    }
  });
}

/** Create two isolated contexts + pages for a two-player test. */
export async function setupTwoPlayers(browser: {
  newContext: () => Promise<BrowserContext>;
}): Promise<{
  ctx1: BrowserContext;
  ctx2: BrowserContext;
  page1: Page;
  page2: Page;
}> {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();
  attachErrorLogging(page1, "P1");
  attachErrorLogging(page2, "P2");
  return { ctx1, ctx2, page1, page2 };
}
