import type { Env } from "./game-room.ts";

export { GameRoom } from "./game-room.ts";

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Create a new game: mint an ID. The Durable Object is created
    // lazily on the first WebSocket connection.
    if (url.pathname === "/api/game" && request.method === "POST") {
      const gameId = generateGameId();
      return Response.json({ gameId });
    }

    // WebSocket endpoint, forwarded to the game's Durable Object.
    const wsMatch = url.pathname.match(/^\/api\/game\/([a-z0-9]+)\/ws$/);
    if (wsMatch) {
      const gameId = wsMatch[1];
      const id = env.GAME_ROOM.idFromName(gameId);
      const stub = env.GAME_ROOM.get(id);
      return stub.fetch(request);
    }

    // Everything else: static assets with SPA fallback so /:gameId
    // routes resolve to index.html for client-side routing.
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status === 404 && request.method === "GET") {
      const indexRequest = new Request(new URL("/", request.url), request);
      return env.ASSETS.fetch(indexRequest);
    }
    return assetResponse;
  },
} satisfies ExportedHandler<Env>;
