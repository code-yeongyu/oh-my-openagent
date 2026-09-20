# Openference Senpi provider - QA evidence

**Date:** 2026-09-20
**Branch:** `feat/openference-senpi-provider`
**Scope:** new `openference-provider` component (`packages/omo-senpi/src/components/openference-provider/`) + registration in `src/extension/component-list.ts` + tsconfig `resolveJsonModule` + generator `packages/omo-senpi/scripts/generate-openference-models.ts`.

## Expected impact map

| Surface | Expected | Verified |
|---|---|---|
| Component credential gate | without `OPENFERENCE_API_KEY`/auth.json entry, `models.json` is never created or touched | yes (unit tests; hostless) |
| Component merge | fill-only-missing provider block + 15-model catalog; user values always win; idempotent second run writes nothing | yes (unit tests; hostless) |
| Extension composition | component registers through the standard roster with the `omo-senpi-openference-provider-disabled` flag | yes (`bun test packages/omo-senpi/src/extension/` -> 100 pass) |
| Real engine consumes the artifact | the installed Senpi engine reads the written `models.json` and lists the models | yes (run 2, live harness) |
| Live completion through the engine | `openference/GLM-5.2` answers through `https://api.openference.com/v1` | yes (run 3, live harness) |
| Host data isolation | all writes land in an isolated agent dir; the real `~/.omo/agent` untouched | yes (isolation proof below) |

## How it was run

Real harness: the machine's installed Senpi engine (`@code-yeongyu/senpi` 2026.9.16-3, the
engine `omo` 5.0.0-0.beta.68 spawns), driven directly so the QA never reads or writes the
host's real `~/.omo/agent`:

```
agent dir: fresh temp dir with a settings.json sentinel, pinned via
           OMO_CODING_AGENT_DIR / SENPI_CODING_AGENT_DIR / PI_CODING_AGENT_DIR
credential: OPENFERENCE_API_KEY set in the QA process environment
artifact:  produced by running the REAL component source (bun one-shot importing
           packages/omo-senpi/src/components/openference-provider/index.ts) against
           the isolated agent dir - not a hand-written file
```

```bash
# run 1: the component (real code) registered against the isolated agent dir
bun <qa-driver>.ts                     # wrote models.json: providers.openference, 15 models,
                                       # apiKey "$OPENFERENCE_API_KEY", User-Agent "pi/openference"
# run 2: the real engine consumes the artifact
node <installed-senpi>/dist/cli.js --list-models
# run 3: live completion through the real engine
node <installed-senpi>/dist/cli.js -p --provider openference --model "GLM-5.2" "Reply with exactly one word: ok"
```

Raw captures:

- `run1-artifact-models.json` — the `models.json` the component wrote (the artifact the engine reads)
- `run2-engine-list-models.txt` — openference excerpt of the real engine's `--list-models` output:
  **15 openference models** with the catalog's exact windows (GLM-5.2 262.1K/128K,
  DeepSeek-V4-Pro-0813 1.0M/384K, Kimi K2.7 Code 262.1K/131.1K, reasoning yes, image flags per model)
- `run3-live-chat-glm-5.2.txt` — stdout of the live run: `ok` (stderr log empty, exit 0)

## Why there is no regression

1. **Gating:** without a credential the component returns before any filesystem touch
   (`index.test.ts` "does nothing without a credential"; `auth.test.ts` matrix).
2. **User ownership:** every merge level is fill-only-missing; unparsable or incompatible
   `models.json` shapes abort with a warning and leave the file byte-identical
   (`merge.test.ts`, `index.test.ts`).
3. **Composition:** the extension suite passes unchanged with the component registered
   (100 pass / 0 fail), including `component-list`, `compose`, and session-start ordering.
4. **Isolation proof:** the engine QA ran against a temp agent dir pinned by env; the host's
   real `~/.omo/agent` (settings, auth.json, sessions) was never passed to any QA command.

## Residuals (honest limits of this evidence)

- The full plugin BUNDLE (`plugin/extensions/omo.js`) was not rebuilt on this Windows
  checkout: the repo pins Bun 1.4.0 and this machine has 1.3.5, whose `bun build` does not
  emit the metafile `build-artifact.mjs` attaches (`sdk.js.meta.json`). CI builds with the
  pinned version. The component's own code path was still exercised against the real
  engine via direct import (runs 1-3 above).
- `bun test packages/omo-senpi` on this Windows checkout has 6 pre-existing failures
  (installer/source-refresh/RPC-on-Windows/init-deep-advisor UI), verified identical on a
  clean `dev` stash, plus a pre-existing Bun 1.3.5 crash inside a git-worktree-spawning
  test. None touch the openference-provider; the suites that cover this change are green
  (component 30 pass, extension 100 pass, `tsgo --noEmit -p packages/omo-senpi` exit 0).
