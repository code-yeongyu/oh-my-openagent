# Direct Remote Skill MCP QA

## Regression

The initial targeted run used Bun 1.3.12:

```text
bun test packages/skills-loader-core/src/features/opencode-skill-loader/loader.test.ts packages/skills-loader-core/src/features/opencode-skill-loader/async-loader-path-and-mcp.test.ts
```

All 14 existing cases passed. Both new direct remote cases failed because the loaded URL was `undefined`.

## Automated Checks

- `bun test packages/skills-loader-core/src` passed 233 tests with 0 failures.
- `tsgo --noEmit -p packages/skills-loader-core/tsconfig.json` passed.
- `git diff --check -- packages/skills-loader-core/src/features/opencode-skill-loader` passed.
- The full monorepo `bun run typecheck` passed.
- The full bundle could not complete because its strict frontend materialization stalled while cloning `nexu-io/open-design`. The clone was stopped before the 150 GiB disk floor and its partial checkout was removed.
- The full monorepo test run was stopped at 55 seconds. Its failures came from sparse-checkout assets and generated bundles outside this package, including missing `.cursor`, `.devcontainer`, Codex payloads, Senpi Skill payloads, and frontend submodules. The complete `skills-loader-core` suite remained green.

## OpenCode QA

`qa.mjs` ran OpenCode 1.17.7 with:

- a temporary `HOME` and isolated XDG directories;
- the local plugin source;
- a standalone Skill with a direct remote `mcp.json` map;
- a fake OpenAI Responses server;
- a localhost Streamable HTTP MCP fixture.

Observed result:

- `skill` completed and exposed the remote `ping` capability;
- `skill_mcp` completed;
- the MCP fixture received exactly 1 `ping` call;
- OpenCode returned `REMOTE_MCP_OK` and exited with code 0.

Artifacts:

- `qa-summary.json` contains the machine-readable assertions.
- `opencode.ndjson` contains the 9-event OpenCode transcript.
- `opencode.stderr.txt` is empty.
- `qa.mjs` reproduces the isolated run.
