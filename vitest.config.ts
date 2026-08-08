import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Engine (src/shared) + server-side logic like the bot heuristic.
    include: ["src/**/*.test.ts"],
    // .claude/worktrees holds throwaway copies of the repo; without this
    // vitest discovers and runs their stale duplicates of every suite.
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**", "e2e/**"],
  },
});
