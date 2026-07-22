import { DurableObject } from "cloudflare:workers";
import { PLAYER_ICONS } from "../shared/types.ts";
import type {
  BoardState,
  Color,
  DicePair,
  Die,
  Move,
  PlayerIcon,
  SeriesSeed,
} from "../shared/types.ts";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import { assertValidBoard } from "../shared/engine/board.ts";
import {
  addPlayer,
  confirmTurn,
  createGame,
  createRematch,
  buildSeed,
  passNoMoves,
  rollDice,
  rollOpeningDie,
  seedGame,
  setPlayerConnected,
  startGame,
} from "../shared/engine/game.ts";
import type { GameState } from "../shared/engine/game.ts";
import { buildCompleteMessage, getPlayerView, lobbyInfo } from "./views.ts";

export interface Env {
  GAME_ROOM: DurableObjectNamespace<GameRoom>;
  ASSETS: Fetcher;
  /** "1" to enable test-only messages like _test_force_rolls. */
  TEST_HOOKS?: string;
}

const CELEBRATION_GIFS = [
  "https://i.giphy.com/media/KEVNWkmWm6dm8/giphy.gif",
  "https://i.giphy.com/media/3kD720zFVu22rfIA0s/giphy.gif",
  "https://i.giphy.com/media/dtxA3U6yLPRW569tCu/giphy.gif",
  "https://i.giphy.com/media/o75ajIFH0QnQC3nCeD/giphy.gif",
  "https://i.giphy.com/media/RPwrO4b46mOdy/giphy.gif",
  "https://i.giphy.com/media/yoJC2JaiEMoxIhQhY4/giphy.gif",
  "https://i.giphy.com/media/lZTvTGEGKU6gnQ2wBr/giphy.gif",
  "https://i.giphy.com/media/S2jPUl8fNnydeNZD0g/giphy.gif",
  "https://i.giphy.com/media/hzqkBHPKL3z07ORokF/giphy.gif",
  "https://i.giphy.com/media/lMameLIF8voLu8HxWV/giphy.gif",
  "https://i.giphy.com/media/K3RxMSrERT8iI/giphy.gif",
  "https://i.giphy.com/media/lnlAifQdenMxW/giphy.gif",
  "https://i.giphy.com/media/BylKa7s0D8BTMnBaSH/giphy.gif",
  "https://i.giphy.com/media/d7fKljD4WRftoHF031/giphy.gif",
  "https://i.giphy.com/media/fUQ4rhUZJYiQsas6WD/giphy.gif",
  "https://i.giphy.com/media/pa37AAGzKXoek/giphy.gif",
  "https://i.giphy.com/media/9wcu6Tr1ecmxa/giphy.gif",
  "https://i.giphy.com/media/15BuyagtKucHm/giphy.gif",
  "https://i.giphy.com/media/TcKmUDTdICRwY/giphy.gif",
  "https://i.giphy.com/media/3oFzm6XsCKxVRbZDLq/giphy.gif",
];

/** How long the "no legal moves" banner shows before the turn auto-passes. */
const NO_MOVES_DELAY_MS = 2500;

export class GameRoom extends DurableObject<Env> {
  private gameState: GameState | null = null;
  /** TEST_HOOKS-only queue of predetermined die values (see protocol). */
  private forcedRolls: Die[] | null = null;

  // ── State persistence ────────────────────────────────────────────

  private async loadState(): Promise<GameState> {
    if (this.gameState) return this.gameState;

    const stored = await this.ctx.storage.get<GameState>("state");
    if (stored) {
      this.gameState = stored;
      return this.gameState;
    }

    // First access: create an empty lobby. The gameId will be set from the
    // URL path on the first fetch() call.
    this.gameState = createGame("");
    return this.gameState;
  }

  private async saveState(newState: GameState): Promise<void> {
    this.gameState = newState;
    await this.ctx.storage.put("state", newState);
  }

  // ── Dice ─────────────────────────────────────────────────────────

  private async takeForcedRoll(): Promise<Die | null> {
    if (this.env.TEST_HOOKS !== "1") return null;
    if (this.forcedRolls === null) {
      this.forcedRolls =
        (await this.ctx.storage.get<Die[]>("forcedRolls")) ?? [];
    }
    if (this.forcedRolls.length === 0) return null;
    const die = this.forcedRolls.shift()!;
    await this.ctx.storage.put("forcedRolls", this.forcedRolls);
    return die;
  }

  private async rollDie(): Promise<Die> {
    const forced = await this.takeForcedRoll();
    if (forced) return forced;
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    // Modulo bias over 2^32 is ~1e-10 per face — irrelevant for a game.
    return ((buf[0] % 6) + 1) as Die;
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private getPlayerIdFromSocket(ws: WebSocket): string | null {
    const tags = this.ctx.getTags(ws);
    return tags.length > 0 ? tags[0] : null;
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket may have closed between check and send; swallow.
    }
  }

  /**
   * Broadcast to every connected socket:
   * - Players receive their personalised StateMessage.
   * - Non-players (viewing the join form) receive a LobbyInfoMessage so the
   *   UI can show which names/icons are already taken.
   * - If the game has completed, every connected client also gets a
   *   GameCompleteMessage with the persisted celebration GIF. Sending it
   *   on every broadcast means a reconnecting client always lands on the
   *   win screen with the same data.
   */
  private broadcastState(state: GameState): void {
    const info = lobbyInfo(state);
    const completeMsg = buildCompleteMessage(state);
    for (const ws of this.ctx.getWebSockets()) {
      const tags = this.ctx.getTags(ws);
      const playerId = tags[0];
      if (!playerId) continue;

      const isPlayer = state.players.some((p) => p.playerId === playerId);
      if (isPlayer) {
        this.send(ws, getPlayerView(state, playerId));
      } else {
        this.send(ws, info);
      }
      if (completeMsg) this.send(ws, completeMsg);
    }
  }

  /** Send the same message to every connected socket. */
  private broadcastToAll(msg: ServerMessage): void {
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, msg);
    }
  }

  // ── HTTP handler (seed + WebSocket upgrade) ──────────────────────
  //
  // The client ALWAYS connects with ?playerId=<uuid> in the URL.
  // - New players: client generates a UUID first, connects, then sends a
  //   "join" message with name + icon.
  // - Returning players: client reads the UUID from localStorage, connects
  //   with it, and sends a "reconnect" message.
  //
  // This means every accepted WebSocket is tagged with a playerId from the
  // start, which keeps the hibernation API usage clean.

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal series-seeding endpoint, called DO-to-DO when a rematch
    // is created. Unreachable from outside: the worker only routes
    // /api/game/:id/ws paths to this object.
    if (url.pathname === "/seed" && request.method === "POST") {
      return this.handleSeed(request);
    }

    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    // Extract game ID from URL and ensure state is initialised
    const pathMatch = url.pathname.match(/\/api\/game\/([a-z0-9]+)\/ws/);
    const gameId = pathMatch ? pathMatch[1] : "";
    let state = await this.loadState();
    if (!state.gameId) {
      state = { ...state, gameId };
      await this.saveState(state);
    }

    // playerId is required in the query string
    const playerId = url.searchParams.get("playerId");
    if (!playerId) {
      return new Response("Missing playerId query parameter", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Always tag the socket with the playerId
    this.ctx.acceptWebSocket(server, [playerId]);

    // If this player already exists in the game, mark them connected and
    // push the current state immediately so the client doesn't flash empty.
    const existingPlayer = state.players.some((p) => p.playerId === playerId);
    if (existingPlayer) {
      state = setPlayerConnected(state, playerId, true);
      await this.saveState(state);
      this.send(server, getPlayerView(state, playerId));
      this.broadcastToAll({ type: "player_reconnected", playerId });
    } else {
      // New (non-player) socket -- send the lobby info so the join form
      // knows which names/icons are already taken.
      this.send(server, lobbyInfo(state));
    }

    // Whether or not they're a player, if the game is already complete,
    // send the game-complete payload so the win screen shows up
    // immediately (e.g. someone reopens the URL after the game ended).
    const completeMsg = buildCompleteMessage(state);
    if (completeMsg) this.send(server, completeMsg);

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Initialize this (brand-new) game with the series carried over from a
   * finished one. Only an untouched lobby may be seeded — anything else
   * means a race or a replay, and is refused.
   */
  private async handleSeed(request: Request): Promise<Response> {
    const state = await this.loadState();
    if (state.players.length > 0 || state.seed || state.phase !== "lobby") {
      return new Response("Game already in use", { status: 409 });
    }

    const seed = (await request.json()) as SeriesSeed;
    if (
      !seed ||
      !Array.isArray(seed.entries) ||
      seed.entries.length > 2 ||
      typeof seed.gamesPlayed !== "number"
    ) {
      return new Response("Malformed seed", { status: 400 });
    }

    await this.saveState(seedGame(state.gameId, seed));
    return new Response("Seeded", { status: 200 });
  }

  // ── Hibernation event handlers ───────────────────────────────────

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== "string") return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(message) as ClientMessage;
    } catch {
      this.send(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    try {
      await this.handleMessage(ws, msg);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      this.send(ws, { type: "error", message: errMsg });
    }
  }

  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const playerId = this.getPlayerIdFromSocket(ws);
    if (!playerId) return;

    const state = await this.loadState();
    const playerExists = state.players.some((p) => p.playerId === playerId);
    if (!playerExists) return;

    // Only mark disconnected if this was the player's last socket
    const remaining = this.ctx.getWebSockets(playerId).filter((s) => s !== ws);
    if (remaining.length === 0) {
      const newState = setPlayerConnected(state, playerId, false);
      await this.saveState(newState);
      this.broadcastToAll({ type: "player_disconnected", playerId });
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    await this.webSocketClose(ws, 1006, "error", false);
  }

  // ── Alarm handler (no-legal-moves auto-pass) ─────────────────────

  async alarm(): Promise<void> {
    let state = await this.loadState();
    if (state.phase !== "playing" || state.turn?.phase !== "no_moves") return;

    state = passNoMoves(state);
    await this.saveState(state);
    this.broadcastState(state);
  }

  // ── Message dispatch ─────────────────────────────────────────────

  private async handleMessage(
    ws: WebSocket,
    msg: ClientMessage,
  ): Promise<void> {
    switch (msg.type) {
      case "ping":
        this.send(ws, { type: "pong" });
        return;

      case "join":
        await this.handleJoin(ws, msg.playerId, msg.name, msg.icon);
        return;

      case "reconnect":
        await this.handleReconnect(ws, msg.playerId);
        return;

      case "start_game":
        await this.handleStartGame(ws);
        return;

      case "roll_opening":
        await this.handleRollOpening(ws);
        return;

      case "roll_dice":
        await this.handleRollDice(ws);
        return;

      case "confirm_moves":
        await this.handleConfirmMoves(ws, msg.moves);
        return;

      case "create_rematch":
        await this.handleCreateRematch(ws);
        return;

      case "_test_force_rolls":
        await this.handleTestForceRolls(msg.rolls);
        return;

      case "_test_set_position":
        await this.handleTestSetPosition(msg.board, msg.turnColor);
        return;

      default:
        this.send(ws, { type: "error", message: "Unknown message type" });
    }
  }

  // ── Individual handlers ──────────────────────────────────────────

  private async handleJoin(
    _ws: WebSocket,
    playerId: string,
    name: string,
    icon: string,
  ): Promise<void> {
    if (!PLAYER_ICONS.includes(icon as PlayerIcon)) {
      throw new Error("Unknown icon");
    }

    let state = await this.loadState();
    // The socket is already tagged with this playerId from fetch().
    state = addPlayer(state, playerId, String(name), icon as PlayerIcon);
    await this.saveState(state);

    // Broadcast personalised state to everyone (including the joiner).
    // This is simpler and always correct compared to sending player_joined
    // deltas -- each client always has the full view.
    this.broadcastState(state);
  }

  private async handleReconnect(
    ws: WebSocket,
    playerId: string,
  ): Promise<void> {
    let state = await this.loadState();

    const playerExists = state.players.some((p) => p.playerId === playerId);
    if (!playerExists) {
      this.send(ws, {
        type: "error",
        message: "Player not found. Please join as a new player.",
      });
      return;
    }

    state = setPlayerConnected(state, playerId, true);
    await this.saveState(state);

    // Send full state to the reconnected player
    this.send(ws, getPlayerView(state, playerId));

    // Notify everyone
    this.broadcastToAll({ type: "player_reconnected", playerId });
  }

  private requirePlayerId(ws: WebSocket): string {
    const playerId = this.getPlayerIdFromSocket(ws);
    if (!playerId) {
      throw new Error("Not identified");
    }
    return playerId;
  }

  private async handleStartGame(ws: WebSocket): Promise<void> {
    const playerId = this.requirePlayerId(ws);
    let state = await this.loadState();
    state = startGame(state, playerId);
    await this.saveState(state);
    this.broadcastState(state);
  }

  private async handleRollOpening(ws: WebSocket): Promise<void> {
    const playerId = this.requirePlayerId(ws);
    let state = await this.loadState();
    const die = await this.rollDie();
    state = rollOpeningDie(state, playerId, die);
    await this.saveState(state);
    this.broadcastState(state);

    // The opening roll can theoretically land the first player in
    // no_moves; keep the auto-pass path uniform.
    await this.armNoMovesAlarmIfNeeded(state);
  }

  private async handleRollDice(ws: WebSocket): Promise<void> {
    const playerId = this.requirePlayerId(ws);
    let state = await this.loadState();
    const dice: DicePair = [await this.rollDie(), await this.rollDie()];
    state = rollDice(state, playerId, dice);
    await this.saveState(state);
    this.broadcastState(state);

    await this.armNoMovesAlarmIfNeeded(state);
  }

  private async armNoMovesAlarmIfNeeded(state: GameState): Promise<void> {
    if (state.phase === "playing" && state.turn?.phase === "no_moves") {
      await this.ctx.storage.setAlarm(Date.now() + NO_MOVES_DELAY_MS);
    }
  }

  private async handleConfirmMoves(
    ws: WebSocket,
    moves: unknown,
  ): Promise<void> {
    const playerId = this.requirePlayerId(ws);

    // Shape-validate untrusted JSON before it reaches the engine.
    if (!Array.isArray(moves) || moves.length > 4) {
      throw new Error("Malformed move list");
    }
    const clean: Move[] = moves.map((m) => {
      const from = (m as Move)?.from;
      const die = (m as Move)?.die;
      if (
        !Number.isInteger(from) ||
        from < 1 ||
        from > 25 ||
        !Number.isInteger(die) ||
        die < 1 ||
        die > 6
      ) {
        throw new Error("Malformed move");
      }
      return { from, die };
    });

    let state = await this.loadState();
    state = confirmTurn(state, playerId, clean);

    // If this turn ended the game, pick a celebration GIF and pin it to
    // the state so reconnecting clients see the same one.
    if (state.phase === "complete" && !state.celebrationGif) {
      const gifIndex = Math.floor(Math.random() * CELEBRATION_GIFS.length);
      state = { ...state, celebrationGif: CELEBRATION_GIFS[gifIndex] };
    }

    await this.saveState(state);
    this.broadcastState(state);
  }

  /**
   * Player opened a rematch from the win screen. We:
   *   1. Generate a new gameId and push the series seed to the new
   *      game's Durable Object (so scores carry over).
   *   2. Attach the rematch pointer to this game's state and broadcast,
   *      so everyone sees the "Join X's Next Game" CTA.
   *   3. The creator gets a client-side navigate to the new game (they
   *      initiated it); the other player follows at their leisure.
   *
   * Calling this twice on the same game is a no-op for the 2nd caller
   * — `createRematch()` throws if a rematch already exists.
   */
  private async handleCreateRematch(ws: WebSocket): Promise<void> {
    const playerId = this.requirePlayerId(ws);
    let state = await this.loadState();

    if (state.rematch) {
      throw new Error("A rematch has already been created");
    }

    const newGameId = generateGameId();
    await this.pushSeed(newGameId, buildSeed(state));

    state = createRematch(state, playerId, newGameId);
    await this.saveState(state);
    this.broadcastState(state);
  }

  /**
   * Seed the rematch game's DO with the running series before anyone can
   * join it. Broadcast of the new gameId only happens after this settles,
   * so a join can never race the seed. On repeated failure we proceed
   * unseeded — the rematch still works, just with a fresh 0-0 series.
   */
  private async pushSeed(newGameId: string, seed: SeriesSeed): Promise<void> {
    const id = this.env.GAME_ROOM.idFromName(newGameId);
    const stub = this.env.GAME_ROOM.get(id);
    const request = () =>
      stub.fetch("https://internal/seed", {
        method: "POST",
        body: JSON.stringify(seed),
        headers: { "Content-Type": "application/json" },
      });

    try {
      const res = await request();
      if (!res.ok && res.status !== 409) {
        await request();
      }
    } catch {
      try {
        await request();
      } catch {
        // Give up: the rematch proceeds with a fresh series.
      }
    }
  }

  /** TEST-ONLY: queue deterministic die values. See protocol.ts. */
  private async handleTestForceRolls(rolls: unknown): Promise<void> {
    if (this.env.TEST_HOOKS !== "1") return;
    if (
      !Array.isArray(rolls) ||
      rolls.length > 64 ||
      rolls.some((r) => !Number.isInteger(r) || r < 1 || r > 6)
    ) {
      throw new Error("Malformed roll list");
    }
    this.forcedRolls = rolls as Die[];
    await this.ctx.storage.put("forcedRolls", this.forcedRolls);
  }

  /** TEST-ONLY: swap in a board position and hand the roll to a color. */
  private async handleTestSetPosition(
    board: unknown,
    turnColor: unknown,
  ): Promise<void> {
    if (this.env.TEST_HOOKS !== "1") return;

    if (turnColor !== "white" && turnColor !== "black") {
      throw new Error("Malformed turn color");
    }
    const candidate = board as BoardState;
    assertValidBoard(candidate); // throws with a useful message

    let state = await this.loadState();
    if (state.players.length !== 2) {
      throw new Error("Set position requires 2 joined players");
    }

    state = {
      ...state,
      phase: "playing",
      board: candidate,
      opening: null,
      turnNumber: state.turnNumber + 1,
      lastTurn: null,
      winner: null,
      turn: {
        color: turnColor as Color,
        phase: "roll",
        dice: null,
        maxPlayable: 0,
        forcedDie: null,
      },
    };
    await this.saveState(state);
    this.broadcastState(state);
  }
}

// ── Utility ────────────────────────────────────────────────────────

const ALPHANUM = "abcdefghijklmnopqrstuvwxyz0123456789";

function generateGameId(): string {
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += ALPHANUM[buf[i] % ALPHANUM.length];
  }
  return id;
}
