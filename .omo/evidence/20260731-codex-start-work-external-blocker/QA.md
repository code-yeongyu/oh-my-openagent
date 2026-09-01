# QA: start-work Stop hook honors a conclusive external blocker

Fixes `code-yeongyu/lazycodex#144`. Scope: `packages/omo-codex/plugin/components/start-work-continuation/`.
Because the change lives under `packages/omo-codex/`, the Codex-side QA mandate applies: the real component CLI was
driven over stdin exactly the way Codex invokes the `Stop` hook, and the real `~/.codex` was proven untouched.

## What was tested

| # | Command / action | Surface driven | Behavior it proves |
|---|---|---|---|
| 1 | `npx vitest --run test/codex-hook.test.ts` | component unit seam (`runStopHook`) | New regression case fails before the fix (RED) |
| 2 | `npm run test` in the component | build + full component suite (3 files) | Fix flips RED to GREEN with no regression (GREEN) |
| 3 | `npx tsc --noEmit` in the component | TypeScript strict typecheck | No type regression |
| 4 | `cli-smoke.ps1` -> `node dist/cli.js hook stop < payload.json` | REAL built hook CLI over stdin | End-to-end hook behavior a Codex session would observe |
| 5 | `node --test packages/omo-codex/plugin/test/*.test.mjs` (50 files) | plugin aggregate suite | No cross-component regression |
| 6 | `bun run test:codex` | Codex compatibility gate | Gate status on this machine |

`cli-smoke.ps1` builds a throwaway workspace containing `.omo/boulder.json` (active work, `codex:smoke-session`) and a
two-task `.omo/plans/test.md`, then fires five payloads that differ ONLY in `last_assistant_message`:

- **A** ordinary answer -> continuation must still be injected
- **B** `<start-work-blocked-external>` as the entire first line, followed by the stated blocker -> the turn must be
  allowed to end
- **C** the same marker present but NOT on the first line -> continuation must still be injected (false-positive guard)
- **D** ultrawork's mandatory `ULTRAWORK MODE ENABLED!` opener followed by the marker on the second line, then the
  stated blocker -> the turn must be allowed to end
- **E** a bare marker with no stated blocker -> continuation must still be injected (added 2026-08-04)

The contract is therefore not strictly "first line only". The marker is honored as the entire first line, or as the
entire second line when the ultrawork opener occupies the first, and in both cases at least one following line must
actually state the blocker. Case D is the only place the second form is exercised, case C keeps the allowance
structural rather than a substring match, and case E keeps a bare marker from ending the turn.

Case E exists because a marker alone is exactly what a quoted echo, or untrusted text the agent read during the task,
would produce. `directive.md` already required the blocker and the resume condition on the following lines, so the hook
now enforces what the directive asks for instead of trusting the marker by itself.

## What was observed

RED (`red-codex-hook.txt`), before any production change:

```
FAIL  test/codex-hook.test.ts > start-work Stop hook > #given active codex work and an external-blocker marker #when hook runs #then returns empty output
AssertionError: expected '{"decision":"block","reason":"<start-…' to be '' // Object.is equality
Tests  1 failed | 11 passed (12)
```

GREEN (`green-component-vitest.txt`): `Test Files 3 passed (3)` / `Tests 40 passed (40)`. Typecheck
(`typecheck-component.txt`): `tsc exit=0`.

Real hook CLI, before vs after. Only `src/codex-hook.ts` was stashed between the two runs, so the delta is attributable
to the fix alone (`cli-smoke-before-fix.txt`, `cli-smoke-after-fix.txt`):

| Case | Before fix | After fix |
|---|---|---|
| A ordinary answer | BLOCK (continuation injected), 9968 bytes | BLOCK (continuation injected), 10092 bytes |
| B marker on first line | BLOCK (continuation injected), 9968 bytes | **NO OUTPUT (Stop allowed), 0 bytes** |
| C marker below first line | BLOCK (continuation injected), 9968 bytes | BLOCK (continuation injected), 10092 bytes |
| D ultrawork opener, marker on second line | not captured | **NO OUTPUT (Stop allowed), 0 bytes** |
| E bare marker, no stated blocker | not captured | BLOCK (continuation injected), 10092 bytes |

Case B is the bug and the fix; case D is the ultrawork form of the same allowance. Cases A and C keep the BLOCK verdict
across the change, so the continuation contract and the false-positive guard are intact.

Two honest caveats about this table, both corrected on 2026-08-04 after review:

- The A and C payloads are **not** byte-identical across the runs (9968 -> 10092). Only the verdict is unchanged. The
  reason payload grew because `directive.md` gained the blocker-marker instruction, which is part of this change, so the
  size delta is expected rather than a regression.
- Case D has no before-fix row because the ultrawork second-line form was added after `cli-smoke-before-fix.txt` was
  captured. `cli-smoke-before-fix.txt` contains A, B and C only. Its RED counterpart is the unit seam, where the
  ultrawork case fails without the fix.

Isolation: the smoke script hashes the real `~/.codex/config.toml` before and after every run and reported
`unchanged: True` in both. The hook only reads the payload `cwd`; it never touches `CODEX_HOME`. The throwaway
workspace is deleted at the end of the script (`temp workspace removed: ...`), so no QA state is left behind.

Plugin aggregate suite (`plugin-aggregate-node-test.txt`): `tests 358 / pass 357 / fail 1`. The single failure is
`component-bundled-cli.test.mjs` in the **lsp** component, an `EPERM` while removing a Windows temp directory. It is a
Windows file-lock artifact in a component this change does not touch.

`bun run test:codex` (`test-codex-gate.txt`) halts on this machine inside the vendored `packages/lsp-tools-mcp` step
with two `test/process.test.ts` assertions that compare a bare `typescript-language-server.cmd` against the absolute
path resolved from this machine's global npm prefix. `preexisting-lsp-tools-mcp-failure.txt` reproduces the identical
two failures with ALL of `packages/omo-codex` stashed, which proves they are pre-existing and environment-driven rather
than caused by this change. The remaining Codex-gate steps that do cover this change were run individually and are
recorded above.

Additional live harness artifacts:

- `app-server-plugin-20260731.txt`: canonical isolated `codex app-server`
  self-test and local-plugin turn, with first-party notifications and unchanged
  real Codex config proof. Its earlier Stop-specific claim was withdrawn on
  2026-08-03; the file records why.
- `app-server-plugin-expect-stop-20260803.txt` (+ `.raw.txt`): the Stop case
  rerun as `--plugin --expect stop`, so the driver fails unless `stop`
  completes. It exited 0 having recorded `hook/started` and `hook/completed`
  for `stop:19:...\hooks\stop-checking-start-work-continuation.json`, which is
  this component's own Stop registration.

## Why it is enough

The defect is that `StopInput.last_assistant_message` was declared in `types.ts` and validated by `isStopInput()` while
`runStopHook()` never read it, so no answer the agent could write would ever end the turn. The evidence closes that at
both levels: the unit seam pins the decision function, and the built CLI proves the behavior a live Codex `Stop` hook
would actually produce. The before/after CLI runs cover the fix path, the untouched happy path, and the near-miss
false positive, and the two non-target cases keep their BLOCK verdict across the change.

Residual risk: the marker is a plain-text contract between `directive.md` and the hook, so a model that ignores the
directive keeps the old (blocking) behavior. That is the safe direction of failure. A session already mid-flight on an
older directive is unaffected because an absent marker preserves the existing path exactly.

## What was omitted

The live app-server run uses a local mock model and redacts its temporary paths.
No secrets, tokens, credentials, auth headers, or env dumps appear in these
artifacts; the only recorded environment detail is the SHA-256 of the real
`~/.codex/config.toml`, used solely to prove it was not modified. Verbose logs were trimmed to their failure headers
and summaries, and each trimmed file says so on its first line.
