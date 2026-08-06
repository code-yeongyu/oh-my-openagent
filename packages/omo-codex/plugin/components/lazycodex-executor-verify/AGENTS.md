# lazycodex-executor-verify

**Generated:** 2026-07-03

## OVERVIEW

Codex `SubagentStop` hook component: the evidence gate for the ultrawork implementation workers (`lazycodex-worker-low|medium|high`). When a worker stops without a valid evidence receipt, the hook emits `{"decision": "block", "reason": <directive>}` and Codex sends it back to work. Matcher is `^lazycodex-worker-(low|medium|high)$`; read-only roles like `lazycodex-qa-executor` and `lazycodex-gate-reviewer` (same `ultrawork/agents/` family) are NOT gated by this hook. (The historical `lazycodex-executor` agent was removed; this component keeps its name.)

Valid receipt: `last_assistant_message` contains `EVIDENCE_RECORDED: <path>` where `<path>` resolves to a non-empty regular file strictly inside `<cwd>/.omo/evidence/`. Symlinks and directories rejected; containment checked on realpaths (file inside evidence root inside cwd, traversal-safe). A valid receipt clears attempt state and exits silently.

Escape hatches: after 3 blocked attempts (`MAX_ATTEMPTS`) the stop passes and state clears; a transcript containing a context-pressure marker ("context compacted", "context_length_exceeded", ...) passes immediately. Malformed stdin, unknown events, unrelated agents: silent exit 0 (fail-open).

## KEY FILES

| File | Role |
|------|------|
| `src/codex-hook.ts` | Core `runSubagentStopHook()`: input guard, receipt validation, attempt escalation, block decision |
| `src/state.ts` | Attempt counter at `<cwd>/.omo/lazycodex-executor-verify/<session>-<agent>.json`; atomic tmp+rename write; `MAX_ATTEMPTS = 3` |
| `src/directive.ts` | Loads `directive.md` at import time; `renderDirective()` fills `{{ATTEMPT_COUNT}}` + `{{LAST_ASSISTANT_MESSAGE}}` |
| `directive.md` | Korean block message ("your completion claim is not trusted until evidence is recorded"); RUNTIME-READ via `../directive.md` relative to `dist/` |
| `src/cli.ts` | Node bin `lazycodex-executor-verify hook subagent-stop`: stdin JSON in, block JSON (or nothing) on stdout |
| `src/types.ts` | `SubagentStopInput` field guard, `StopHookOutput` (block-only shape), injectable `HookFileSystem` |
| `hooks/hooks.json` | Component-local wiring (Unix `node .../dist/cli.js` command only) |
| `test/codex-hook.test.ts`, `test/cli.test.ts` | Vitest given/when/then: symlink/traversal/zero-byte receipts, attempt escalation and cap, context pressure, malformed stdin |

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Change the block message | `directive.md`; keep both `{{...}}` placeholders and the literal `EVIDENCE_RECORDED: <path>` final-line contract |
| Change receipt validation | `src/codex-hook.ts` (`hasValidEvidenceReceipt`, `extractEvidencePath`, `isNonEmptyFileInsideEvidenceRoot`) |
| Change the retry budget | `src/state.ts` `MAX_ATTEMPTS` |
| Worker-side contract | `../ultrawork/agents/lazycodex-worker-{low,medium,high}.toml` instruct the final `EVIDENCE_RECORDED: <path>` line this hook parses |
| Plugin-level wiring | `../../hooks/subagent-stop-verifying-lazycodex-executor-evidence.json` (adds `commandWindows` via `../bootstrap/scripts/node-dispatch.ps1`) |
| Wiring + contract tests | `../../test/aggregate-hooks.test.mjs`, `../../test/component-hook-contract-cases.mjs`, `../../test/hook-status-message.test.mjs`, `../../test/component-bundled-cli.test.mjs` |

## NOTES

- Node >=20, npm + vitest + biome, TypeScript 6 strict. No Bun APIs: Codex launches hooks with Node. `npm test` builds first, then runs vitest.
- `hooks/hooks.json` (component) and `../../hooks/subagent-stop-verifying-lazycodex-executor-evidence.json` (aggregate) are hand-maintained twins. Edit both or aggregate tests fail. Only the aggregate copy carries the Windows dispatch.
- `dist/` is gitignored, but root `package.json` `files` ships `.../lazycodex-executor-verify/dist/cli.js` and the hook command targets `dist/cli.js`. Nothing works from a fresh clone until a build runs.
- `directive.md` is read at runtime, not bundled: `dist/directive.js` resolves `../directive.md`, so the file must stay at component root (it is in `package.json` `files`).
- `stop_hook_active: true` does NOT bypass the check; the directive says so explicitly. Only the attempt cap and context-pressure markers let a receipt-less stop through.
- Blocking output is the stable Codex stop-hook contract: `decision: "block"` + `reason`, nothing else. A passing stop is empty stdout, exit 0. The only nonzero exit is a CLI usage error.
- The receipt regex takes the first `EVIDENCE_RECORDED:` match and a single `\S+` token: no spaces in evidence paths.
