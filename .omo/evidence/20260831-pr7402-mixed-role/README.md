# PR #7402 mixed reviewer assignment QA

## What was tested

- Failing-first mixed-role regression:
  `npm test -- test/spawn-guard.test.ts`
- Full ulw-loop component suite:
  `npm test`
- Component typecheck, Biome, and build:
  `npm run check`
- Built hook CLI:
  `node dist/cli.js hook pre-tool-use-spawn`
- Real isolated Codex turn:
  `.agents/skills/codex-qa/scripts/app-server-drive.sh --plugin`

## What was observed

### RED

After three allowed `lazycodex-code-reviewer` spawns, the message

```text
Act as lazycodex-qa-executor; verify the lazycodex-code-reviewer finding
```

was denied as `lazycodex-code-reviewer 4/3`.

Focused result: 1 failed, 18 passed.

### GREEN

- Focused result: 19 passed, 0 failed.
- Full component result: 447 passed, 0 failed.
- TypeScript, Biome, and component build passed.
- The built hook CLI accepted all three code-review spawns and the mixed QA
  assignment, then persisted:

```json
{
  "lazycodex-code-reviewer:g1:a1": 3,
  "lazycodex-qa-executor:g1:a1": 1
}
```

- A real Codex app-server turn completed against the local mock model.
- `sessionStart`, `userPromptSubmit`, and `stop` hooks completed.
- The real `~/.codex/config.toml` hash remained unchanged.

## Why this is enough

The regression fails on the exact reviewer-reported prompt and proves the
wrong quota was selected. The built CLI verifies the machine-consumed hook
surface and persisted counters without test mocks. The app-server run proves
the locally built plugin still loads and participates in a real isolated
Codex turn.

## Cleanup

- The built-CLI fixture was created under a task-owned temporary directory and
  removed by its exit trap.
- The Codex driver removed its isolated home and mock model process.
- No task-owned server, process, port, or temporary directory remains.

## Other gate observation

The repository-wide `bun run test:codex` reached the shipped third-party
notice check but its internal npm-pack prepare build failed in this worktree
on three attempts. The failure was not suppressed or reported as green.
Issue #7546 documents the current patched-Senpi bundle failure class; focused
component gates, the root build, and the real Codex surfaces above passed.

## What was omitted

Raw environment values, authentication material, user configuration contents,
absolute temporary paths, and verbose hook payloads.
