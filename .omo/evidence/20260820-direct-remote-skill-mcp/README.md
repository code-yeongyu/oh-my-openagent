# Direct Remote Skill MCP QA

## Regression

The initial targeted run used Bun 1.3.12:

```text
bun test packages/skills-loader-core/src/features/opencode-skill-loader/loader.test.ts packages/skills-loader-core/src/features/opencode-skill-loader/async-loader-path-and-mcp.test.ts
```

All 14 existing cases passed. Both new direct remote cases failed because the loaded URL was `undefined`.

## Automated Checks

The branch was rebased onto `dev` at `7268b12c8` on 2026-08-21. The current-head checks used Bun 1.4.0.

- The 2 focused parser and loader files passed all 16 tests.
- `bun test packages/skills-loader-core/src` passed 233 tests with 0 failures.
- `bunx tsgo --noEmit -p packages/skills-loader-core/tsconfig.json` passed.
- The full monorepo `bun run typecheck` passed.
- `git diff --check upstream/dev...HEAD` passed.
- The full build stopped after 60 seconds in upstream frontend materialization. Its `nexu-io/open-design` clone had stalled. The exact task-owned process was stopped, and generated submodule worktrees were deinitialized.
- The OpenCode QA harness self-check passed its sandbox and database checks. `tmux` was unavailable, so TUI smoke was omitted. This parser change uses the noninteractive CLI surface.

## OpenCode QA

`qa.mjs` ran OpenCode 1.17.7 with:

- a temporary `HOME` and isolated XDG directories;
- the local plugin source;
- a standalone Skill with a direct remote `mcp.json` map;
- a fake OpenAI Responses server;
- a localhost Streamable HTTP MCP fixture.
- a real OpenCode database count before and after the isolated run.

Observed result:

- `skill` completed and exposed the remote `ping` capability;
- `skill_mcp` completed;
- the MCP fixture received exactly 1 `ping` call;
- OpenCode returned `REMOTE_MCP_OK` and exited with code 0;
- the real database contained 7 sessions before and after QA.

Artifacts:

- `qa-summary.json` contains the machine-readable assertions.
- `opencode.ndjson` contains the 9-event OpenCode transcript.
- `opencode.stderr.txt` is empty.
- `qa.mjs` reproduces the isolated run.
