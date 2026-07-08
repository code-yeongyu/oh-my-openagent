WHAT WAS TESTED

- RED: `bun test ./packages/senpi-task/src/agents/loader.test.ts` and `bun test packages/senpi-task/src/agents` before production loader code. The first valid red artifact is `red-focused-agents-tests.txt`; after dependency bootstrap it fails on missing `./registry`, proving the new tests predated the implementation.
- GREEN focused: `bun test packages/senpi-task/src/agents` drove the agent loader unit scenarios.
- GREEN package: `bun test packages/senpi-task --bail` drove all package tests in one Bun process.
- Typecheck: `bun run typecheck` drove the repository typecheck gate.
- Manual QA: `bun packages/senpi-task/scripts/manual-agents-qa.ts .omo/evidence/senpi-task/task-5-agents` created real markdown and `omo.json` fixtures, loaded them through `loadAgents()`, asserted `omo.json` model override wins, asserted markdown `models` and tool allow loading, asserted malformed frontmatter emits a diagnostic while the valid agent still loads, and removed the fixture.
- Guards: no-excuse TypeScript checker, touched-file pure LOC count, no runtime omo-opencode import scan, and no `.claude` / opencode agent path scan.

WHAT WAS OBSERVED

- Focused agents tests passed 7 scenarios covering search-path order, subdirectory-only scanning, programmatic precedence, `omo.json` final overlay, malformed frontmatter diagnostics, last-match-wins tool rules, and snake_case config normalization.
- Manual QA output shows `finderModel: "omo-override"`, `finderModels: ["file-primary", "file-fallback"]`, `finderReadAllowed: true`, a `frontmatter` diagnostic for `broken.md`, and `fixtureExistsAfterCleanup: false`.
- `bun.lock` and `packages/omo-codex/plugin/components/codegraph/dist/serve.js` were byproducts of `bun install --offline`/postinstall and were restored before commit; see `byproduct-cleanup.txt`.

WHY IT IS ENOUGH

- The unit tests pin the complete Todo 5 precedence contract: home files < project files < `registerAgent()` < `omo.json` overlay.
- The manual QA drives the loader through its real filesystem/config surface instead of only direct object construction.
- Static guards prove the change stayed inside `senpi-task`, did not import `omo-opencode`, and did not read `.claude` or opencode agent paths.

WHAT WAS OMITTED

- No OpenCode or Codex harness QA was run because this change is isolated to `packages/senpi-task` and does not touch `packages/omo-opencode` or `packages/omo-codex`.
- No network was used; dependency hydration was run with `bun install --offline` only because the sibling worktree lacked workspace links needed by the repo test preload.
