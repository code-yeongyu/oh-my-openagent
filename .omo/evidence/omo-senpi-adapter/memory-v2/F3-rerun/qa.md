# F3 rerun: real end-to-end memory-v2 QA

**Verdict: F3: PASS**

Date: 2026-08-10  
Branch: `feat/memory-v2-active-learning`  
Branch HEAD at build: `f801a00c58d009ac3a2db84e34867a774908b01c`  
Surface: worktree-local Senpi `2026.8.11` loading the packaged `packages/omo-senpi/plugin` extension  
Isolation: fresh throwaway `HOME`, `XDG_CONFIG_HOME`, `SENPI_CODING_AGENT_DIR`, session directory, project directory, and `OMO_MEMORY_HOME`.

## Method

- Built with the required command: `node packages/omo-senpi/plugin/scripts/build-extension.mjs`.
- Before any scenario action, grepped the generated `omo.js` for the exact current reminder text: `holds local paths of memory projections`.
- Drove one resumed live `senpi -p --mode json` session for seed, nudge, facts, and soul-tool behavior.
- Used the real TUI renderer for the visible soul notice.
- Used Senpi's documented live RPC `prompt` surface for `/dream --recent 1` and `/people Mina`; RPC dispatches registered extension slash commands directly and returned their real `extension_ui_request` notifications.
- Armed recursive `fs.watch` observers before the facts trigger and before the manual dream trigger. All waits were bounded; no fixed sleeps or wait-for-time polling were used.
- Used a deterministic, genuinely resolvable quick model, `omo-mock/mock-1`, for facts and dream children.

## Scenario verdicts

| Step | Verdict | Observation |
|---|---|---|
| 1. Build and current bundle sentinel | **PASS** | Build exited 0. The generated `omo.js` contained `holds local paths of memory projections`; the stale v1 reminder was not used. No `memory.reflection`/memory-v2 config validation error appeared. See `build.txt` and `run.txt`. |
| 2. Fresh first-run seed | **PASS** | First live `senpi -p` run initialized the isolated repo. Seed commit `d1b2281` (`chore: initialize local memory`) contains `system/persona.md` and `system/human.md`; the subsequent memory-tool commit was `704f178`. See `memory-git-log.txt`. |
| 3. Nudge and self-clear | **PASS** | One no-save turn after the initial save had no nudge. The second no-save turn injected exactly `2 user turns since your last memory save`. Memory-tool commit `1a887f6` then cleared the nudge on the next turn. See `system-prompts.txt` and `results.json`. |
| 4. Facts queue and quick extractor | **PASS** | The pre-armed watcher observed facts `final.json` with `outcome: committed`, SHA `026dcd5`. The extractor created `people/mina-kim/card.md` and observations. Commit `3574f0c` carries both `Generated-By: facts-extractor` and `Omo-Writer: facts-extractor`. The quick model was live as `omo-mock/mock-1`; no degradation was needed. |
| 5. Soul notice | **PASS** | Memory `str_replace` committed `system/persona.md` as `0f82863`. The tool result included `This was a soul edit: announce it to the user in your reply.` A persisted `omo-memory:soul-updated` entry was created, and the live TUI rendered `memory soul updated 0f82863: F3 soul edit notice` plus `system/persona.md`. |
| 6. `/dream --recent 1` | **PASS** | Live RPC slash dispatch notified `dream run reflection-run-1 reserved`. The pre-armed watchers observed `outcome.json` and then `final.json`; the reconciled final outcome was successful `no_changes`, child exit code 0, with empty stderr. |
| 7. `/people` | **PASS** | Live RPC slash dispatch rendered `# Mina Kim (mina-kim)` and the extracted observation `Mina Kim is the release manager and prefers concise release checklists.` |
| 8. Evidence and teardown | **PASS** | `results.json` reports 30 checks, 0 failures. Full transcript, prompt dump, session JSONL, and isolated git log are present. No F3 process, tmux server, or `omo-memory-f3-rerun-*` root remained. Bundles were restored with the required checkout; committed `omo.js` is 974,066 bytes and still contains the current reminder. |

## Important harness detail

The dream child inherits the QA provider. Its system-prompt dump is intentionally disabled only for `SENPI_MEMORY_REFLECTION=1`, because the reflection sandbox correctly rejects writes to the parent run's external prompt-log path. This changes only QA logging; it does not bypass configuration, model resolution, command dispatch, worker supervision, or finalization. With that non-product logging side effect removed, the real dream child exited 0 and finalized `no_changes`.

## Evidence index

- `build.txt` - required build command, generated bundle hashes/sizes, and reminder grep.
- `qa-driver.mjs` - deterministic isolated live-surface driver.
- `run.txt` - complete final process/TUI/RPC transcript.
- `transcript.txt` - driver-assembled complete final scenario transcript.
- `results.json` - machine-readable final result: PASS, 30 checks, 0 failures.
- `system-prompts.txt` - injected system prompts, including nudge presence and absence.
- `session.jsonl.txt` - complete isolated Senpi session JSONL.
- `session-files.txt` - isolated session file inventory.
- `memory-git-log.txt` - isolated memory repository history with trailers and changed paths.
- `teardown.txt` - bundle restoration, process/root/tmux audit, sizes, hashes, and final receipt.

## Teardown receipt summary

- F3 child processes: none.
- F3 tmux servers: none.
- F3 isolated roots: none.
- Packaged extension status: clean after `git checkout -- packages/omo-senpi/plugin/extensions/`.
- Restored committed `omo.js`: 974,066 bytes, SHA-256 `1a042a88aa1077be5a12128b34e73a233b981cc4a93120807c45348078f4d003`.
- Unrelated `memory-run-supervisor-ic8-*` fixture processes from concurrent test work were observed and deliberately left untouched.
