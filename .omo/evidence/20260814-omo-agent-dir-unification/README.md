# QA: one canonical omo agent directory

Branch `fix/omo-agent-dir-unification`. Artifacts: `run.sh` (the exact script), `transcript.txt` (its captured output).

## What was tested

`bash run.sh <worktree>` drives the **changed launcher** in an isolated `HOME`, twice over:

1. against the **real pinned engine** (`@code-yeongyu/senpi` symlinked from the developer's global omo-ai install), to prove the product boots and resolves state where it claims to;
2. against a **capture stub** engine that writes the environment it was handed, to prove exactly what the launcher pins for the engine.

The sandbox `HOME` starts with the pre-unification layout only: a single flat `<HOME>/.omo/settings.json` holding `favoriteModels` and `retry.fallbackChains`. Steps: `omo --version`, `omo doctor` twice, `omo setup --dry-run`, one stub run with no override, one stub run with `OMO_CODING_AGENT_DIR` set.

## What was observed

- **Canonical resolution.** The captured child environment is `OMO_CODING_AGENT_DIR = SENPI_CODING_AGENT_DIR = <HOME>/.omo/agent`, with `brandConfigDir: ".omo"` and `brandFlatLayout: false`. `omo setup --dry-run` reported the senpi harness from that same directory and `PASS: no ~/.senpi anywhere in the sandbox` - the directory the old defaults used was never created.
- **Override still wins.** With `OMO_CODING_AGENT_DIR=<SANDBOX>/pinned`, both names arrive at the engine as `<SANDBOX>/pinned`.
- **No reset.** The first launcher invocation printed `omo: carried forward settings from the legacy ~/.omo layout (settings.json)`, after which `<HOME>/.omo/agent/settings.json` held exactly the stranded values: `favoriteModels` `["anthropic/claude-fable-5","apitopia/kimi-k3-unlocked"]` and `fallbackChains` `{"claude-fable-5":[],"openmodel/claude-fable-5":["anthropic-api/claude-fable-5:xhigh"]}`. The flat original stayed byte-identical (`0ba283a2...`).
- **Idempotent.** The second launch printed no adoption notice and left the canonical file unchanged.
- **Boot.** `omo --version` printed `omo 5.0.0-0.beta.7 (engine: senpi 2026.8.12-4)`.

## Isolation

The developer's own state was never read or written by the sandbox:

- `<real HOME>/.omo/agent/.adopted-from-omo-flat` does **not** exist, so the carry-forward never ran outside the sandbox.
- No `settings.json.bak-<timestamp>` from the backfill exists in the real agent directory (the three `.bak-*` files there are hand-made names from earlier sessions, dated Aug 3 / 10 / 12).
- `<real HOME>/.omo/settings.json` hashed `a1ab2671...` before and after the run.
- `<real HOME>/.omo/agent/settings.json` **did** change during the window (`14bbcdea...` to `d5521fca...`). That is the developer's own live omo session, not this QA: the `retry.fallbackChains` value now in that file is a five-entry `claude-fable-5` chain ending in `apitopia/glm-5.2:max`, which appears in neither the sandbox fixture (`"claude-fable-5": []`) nor the flat file, and the two markers above prove no QA write path touched it.

## Why it is enough

Each success criterion is proven on the surface it is about: the engine-facing contract by the environment the engine actually received, the CLI surfaces by running `doctor` and `setup` with no agent-dir configured, and the no-reset guarantee by a before/after of the real files in a home that only had the legacy layout. The unit suites (`packages/omo-native/test/agent-dir.test.ts` and the entry-point tests) cover the branches a single sandbox cannot exercise cheaply: the legacy env prefixes, blank overrides, malformed legacy JSON, the never-overwrite rule, and the skip when the user pinned their own directory.

Residual risk not covered here: the carry-forward reads a directory the user may have edited concurrently. It only ever adds keys the canonical file lacks, and backs that file up first, so a concurrent edit loses nothing.

## What was omitted

`omo setup --dry-run` needs a credential source, so the sandbox opencode `auth.json` holds the literal placeholder `SANDBOX-ONLY-NOT-A-REAL-KEY`. No real key was used and the transcript prints provider ids only, never key material. The `FAIL senpi version: expected 2026.8.13, found 2026.8.12-4` line in the transcript is a sandbox artifact: the branch pins `2026.8.13` while the engine symlinked into the sandbox is the globally installed `2026.8.12-4`. It is not a product defect.

## Cleanup

`removed /tmp/omo-agentdir-qa.d1oOAb` followed by `no QA sandboxes remain`; the earlier interrupted run's directory (`/tmp/omo-agentdir-qa.8vm9LK`) was removed in the same step, and no QA processes survived (`pkill -f omo-agentdir-qa` returned nothing to kill).
