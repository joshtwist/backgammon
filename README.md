# Backgammon

A mobile-first, two-player online backgammon game. No accounts, no
installs — create a game, share the link, play. Built on the same
architecture as [rummy](https://github.com/joshtwist/rummy).

## How it works

- **Create & invite**: the homepage mints a 6-character game ID. The
  invite is just the URL (`/{gameId}`) — share it via the native share
  sheet and your opponent joins with a name + avatar.
- **All the classic rules**: opening roll (higher die starts and plays
  both numbers; ties re-roll), doubles play four moves, blocked points,
  hitting blots, the bar with entry priority, dancing (no legal moves
  auto-passes after a beat), bearing off (exact die, or a higher die
  from the highest point), and forced play — you must play as many dice
  as possible, and the higher die when only one can be played.
- **Drag to move**: drag a glowing checker and it snaps onto a legal
  point (multi-hop drags like 24/13 with a 6-5 work too), or tap a
  checker to auto-play its best single hop. Undo freely, then **Confirm**
  to commit the whole turn — the server validates it atomically.
- **Wins & series**: single game = 1 point, gammon = 2, backgammon = 3.
  "Play Again" starts a rematch in a fresh room and **carries the series
  score** — the running total follows you from game to game.

## Stack

React 19 + Vite + Tailwind CSS v4 + framer-motion on the front;
a single Cloudflare Worker with one **Durable Object per game** on the
back (WebSockets via the hibernation API, state in DO storage). The
rules engine is pure, RNG-free TypeScript shared by client and server —
the client uses it for drag targets and staging, the server for
authoritative validation. Full snapshot broadcast after every mutation
keeps reconnection trivial.

```
src/
├── shared/          # types, wire protocol, and the rules engine
│   └── engine/      # board.ts, moves.ts, game.ts (+ 43 Vitest cases)
├── server/          # Worker entry, GameRoom Durable Object, views
└── client/          # React SPA (components, hooks, lib)
```

## Development

```bash
pnpm install
pnpm start          # vite on :5173 + wrangler dev on :8787
```

Open http://localhost:5173. The Vite dev server proxies `/api` (and
WebSockets) to the local worker.

`.dev.vars` sets `TEST_HOOKS=1` for local dev only — it enables the
`_test_force_rolls` / `_test_set_position` messages the e2e suite uses
to play deterministic games. It is gitignored and never deployed.

## Tests

```bash
pnpm test:unit      # Vitest: the rules-engine matrix (bar, bear-off,
                    # forced play, gammons, series seeding...)
pnpm test           # Playwright e2e: invite/join, opening roll, drag
                    # moves, dance auto-pass, hits, win + rematch with
                    # series carry — on iPhone-sized and desktop Chromium
pnpm typecheck      # client + worker tsconfigs
```

## Deployment

```bash
pnpm run deploy     # build the SPA + wrangler deploy (worker, DO
                    # migration, static assets in one shot)
```

(Note the `run` — bare `pnpm deploy` is pnpm's own workspace command.)

Live at https://backgammon.molmorg.workers.dev

First-time setup: `pnpm wrangler login`, then `pnpm types` to generate
`worker-configuration.d.ts` (gitignored).

Pushes to `main` auto-deploy via GitHub Actions
(`.github/workflows/deploy.yml`), which typechecks, runs the engine
tests, builds, and deploys. Requires two repo secrets:

- `CLOUDFLARE_API_TOKEN` — dashboard → My Profile → API Tokens →
  "Edit Cloudflare Workers" template
- `CLOUDFLARE_ACCOUNT_ID` — shown on Workers & Pages → Overview
