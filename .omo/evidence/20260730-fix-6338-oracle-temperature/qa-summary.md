# QA summary - PR #6485 - fall back to model-family detection when capability metadata is silent

Rewritten 2026-08-04 on Windows 11, bun 1.3.12, opencode 1.18.11, node v24.18.0.

This supersedes the 2026-07-30 and 2026-07-31 versions of this file. Those described a second
fix layer in `agent-config-finalizer.ts` that has since been removed, and they framed the fix
around a model id that current `dev` already handles. See `SCOPE-CORRECTION-20260804.md` for
the correction and the mechanical output behind it.

## What was tested

- Unit RED/GREEN, product reverted to `upstream/dev` and restored:
  `bun test packages/model-core/src/model-settings-compatibility.test.ts`
  -> `red-green-reframed-20260804.txt`
- Integration RED/GREEN through the REAL `chat.params` handler
  (`createChatParamsHandler` from `packages/omo-opencode/src/plugin/chat-params.ts`, the
  boundary where OpenCode hands the plugin the outgoing request parameters):
  `chat-params-driver.ts` -> `chat-params-integration.txt`
- Capability-resolution diagnostic explaining which layer decides temperature:
  `diag-capabilities.ts`
- Suites and typecheck: `bun test packages/model-core`,
  `bun test packages/omo-opencode/src/plugin-handlers`, `bun run typecheck:packages`
  -> `suites-20260803.txt`, `typecheck-20260803.txt`

## What was observed

- Unit: `72 pass / 5 fail` on `dev` -> `77 pass / 0 fail` with the fix. The failures are the
  reasoning-suffixed ids: Claude Opus 4.8 with a `-thinking` suffix, and o-series
  `openai/o3:high`, `openai/o3(high)`, `openai/o3 high`.
- Integration through the real `chat.params` handler, with the product reverted to `dev`:
  - `azure-anthropic/claude-opus-4-8-thinking` -> **temperature 0.1 was sent** (the defect)
  - `azure-anthropic/claude-opus-4-8` -> already dropped on `dev`
  - `anthropic/claude-opus-4-8` -> already dropped on `dev`
  - `openai/gpt-4o` (control) -> temperature 0.1 correctly kept
  With the fix applied, every Opus 4.8 variant drops temperature and the `gpt-4o` control
  still keeps it. The control is what makes this driver non-vacuous.
- Root cause, from `diag-capabilities.ts`: `getModelCapabilities` resolves by canonical model
  id regardless of provider. `claude-opus-4-8` is `snapshot-backed` with
  `supportsTemperature: false`, so any provider already strips it. `claude-opus-4-8-thinking`
  is `heuristic-backed` with `snapshot.source: "none"` and `supportsTemperature.source: "none"`,
  so nothing marked it unsupported and the value survived.
- Suites: model-core `337 pass / 0 fail`, plugin-handlers `228 pass / 0 fail`,
  `bun run typecheck:packages` exit 0.
- The `agent-config-finalizer.ts` layer was reverted to `dev` and confirmed byte-identical.
  Product diff is `+18/-3` across 2 files in `packages/model-core`.

## Why it is enough

The defect is a decision made inside `resolveCompatibleModelSettings`, and `chat.params` is the
only place that decision reaches a request. Driving the real handler with the product reverted
and restored isolates that delta end to end, and the `openai/gpt-4o` control proves the driver
can actually observe a surviving temperature, so `temperature_sent=false` is a real result and
not a harness artifact.

Residual risk: this changes behavior only when capability metadata is silent
(`supportsTemperature === undefined`). Explicit metadata still wins in both directions, pinned
by `keeps temperature when capability metadata explicitly supports it`.

## What was omitted, and one harness that failed to qualify

`live-request-driver.sh` + `mock-provider.mjs` drive real `opencode run` against a local mock
model endpoint that records the request body. They are retained for transparency but their
output is **not** valid evidence: `diag-temp-forwarding.sh` shows a control model that fully
supports temperature (`azure-anthropic/general-chat-1`, agent temperature 0.1) also yields
`TEMPERATURE_IN_REQUEST=false`. OpenCode 1.18.11 does not forward an agent's configured
temperature into the request for a custom openai-compatible provider, so that surface cannot
observe this behavior at all. `live-request-BEFORE.txt` / `live-request-AFTER.txt` are kept
only to document that dead end.

No secrets, auth headers, provider tokens, or environment dumps were recorded. All OpenCode
runs used sandboxed `HOME`/XDG/TMP directories under a `mktemp` dir.
