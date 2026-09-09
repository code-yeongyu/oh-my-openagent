# What was observed

The requested Astra install and migration values were observed through the real committed installer. Required rules/ultrawork hook start/completion pairs were observed through the real Codex app-server. This is not an all-green QA report: the malformed-config negative case failed, and the plugin app-server script timed out after the required hook pairs had completed.

## Installation

`task-7-install-qa-continued.log` and the four `task-7-*-assertions.json` files record:

- Fresh install: `gpt-6-astra`, context 600000, reasoning high, plan reasoning xhigh; 12 `[agents.*]` blocks, 12 Astra agent files, no `agents.max_threads`, and no V2 concurrency cap.
- Legacy Sol seed: upgraded to the same Astra defaults; both seeded 1000 caps removed.
- Custom seed: `gpt-5.6-terra`, reasoning medium, and V2 cap 4 preserved.
- Customized explorer: model upgraded to Astra while reasoning xhigh was preserved.
- Installed marketplace snapshot manifest: 21 hooks, equal to the branch's `jq '.hooks|length'` result; full hook-array equality also passed.
- Runtime cache manifest on macOS: 19 hooks. The two omitted files are `pre-tool-use-recommending-git-bash-mcp.json` and `post-compact-resetting-git-bash-mcp-reminder.json`, exactly the existing non-Windows filtering in `src/install/codex-git-bash-hooks.ts`. Cache hook-array equality against the source minus those two entries passed.

The first fresh assertion incorrectly assumed the runtime cache and source counts were identical and failed with `19 !== 21`. That output is retained in `task-7-install-qa.log`. The follow-up distinguishes the installed marketplace snapshot from the runtime cache and records `cacheVsSourceCountEqual: false`; it does not claim that the cache has 21 hooks. If the task's count-equality requirement means the active cache specifically, it remains unsatisfied on macOS by design.

### Failed malformed-config negative case

The seed was `model = "unterminated` followed by a newline. The installer returned 0 and rewrote it to a complete Astra config instead of returning nonzero and leaving it unchanged. The negative assertion was retained and failed; no product fix or test weakening was made.

- Before SHA-1: `8d54f3d88a9037e1cd606ba9b278f6db27a5ed7f`.
- After SHA-1: `245a351335ae9d6e90e7fbd74b89097ca0da929f`.
- Artifacts: `task-7-malformed-seed.toml`, `task-7-malformed-after.toml`, `task-7-malformed-installer.log`, and the end of `task-7-install-qa-continued.log`.

This behavior was observed on the branch; a malformed-input baseline comparison was not run, so attribution to this PR is unverified.

## Hook and mock-model observations

The bare app-server self-test completed with `Hello from the codex-qa mock model.`. The plugin run recorded matching `hook/started` (running) and `hook/completed` (completed) events, with the same run ID, for:

1. `session-start-loading-project-rules.json` / sessionStart.
2. `user-prompt-submit-loading-project-rules.json` / userPromptSubmit.
3. `user-prompt-submit-checking-ultrawork-trigger.json` / userPromptSubmit.

The plugin result had no missing or failed hooks, but `ok: false`, `turnStatus: null`, and `assistantText: null`; the driver's 90000ms deadline was reached. No retry, longer deadline, or removal of plugin components was used to convert it to a pass. The stderr also reports untrusted project-local configuration was disabled. The timeout's root cause is unverified. See `task-7-app-server-plugin.log` and `task-7-hook-pairs.json`.

The historical raw SessionStart outputs remain byte-compatible with the current shipped rule body. Astra and Astra-fast contain `based on GPT-6`, and GPT-5.5 selects its own rule. `task-7-session-start-reuse.log` records source log line numbers and current body hashes.

The corrected PostCompact proof in `task-3-budget.log` observes the implementation's actual sequence: PostCompact marks state and emits nothing; the next SessionStart source=compact emits the recovery guide. With a 760k retained transcript and 81 project rule sources, Astra and Sol each emitted 4087 characters; unknown-model emitted 665. The prior empty-output/variant-length interpretation is explicitly superseded in that log.

## Remote gates and A/B classification

All results below are from `task-gate-a-remote-tests.log`, reviewed here rather than rerun locally.

| Gate | Revision / host | Observed result |
| --- | --- | --- |
| [a] Scoped Bun including installer, rules-engine and bundle freshness | e87691a6a / mengmotaMac | TEST_EXIT=0; 378 pass, 1 existing Windows-only skip, 0 fail |
| [b] Canonical rules Vitest | e87691a6a / mengmotaMac | TEST_EXIT=0; 171 pass across 30 files |
| [c] Plugin Node suite | e87691a6a / mengmotaMac | TEST_EXIT=0; 336 pass, 0 fail |
| [d] Initial full test:codex | e87691a6a / mengmotaMac | TEST_EXIT=1; autonomy installer case hit 20000ms; final Node stage was not reached |
| [e] Markdown audit | e87691a6a / mengmotaMac | TEST_EXIT=0; 16 pass, 0 fail |
| Full test:codex rerun | b8485e334 / mengmotaMac | TEST_EXIT=0; Bun 465 pass, 1 skip, 0 fail; final Node 495 pass, 0 fail |
| Later branch installer-only run | b8485e334 / mengmotaMac | TEST_EXIT=1; a different case, `never spawns a repo script that is not shipped`, hit 20000ms under recorded load 67-111 on 18 cores |
| Installer A/B | b8485e334 vs dev 1ee26636f / gorky | branch, dev, branch, dev all TEST_EXIT=0 and 11/0; branch min 7.78s, dev min 7.41s, ratio 1.05 |

The recorded A/B classification is LOAD ARTIFACT: no branch timeout reproduced on gorky, and all four runs passed. It supports a host-load explanation, not a claim that installer tests are immune to timing failures. The failed runs remain visible. The recorded remote checkout-removal receipts cover the gate, rerun and A/B directories; small remote receipt directories were intentionally retained by those tasks.

## Verifier rounds and repairs

Available durable records show verify-a3 prompted explicit reconstructed RED/GREEN evidence for todos 2-6; `task-2-red.log`, `task-3-red-green.log`, `task-4-red-green.log`, `task-5-red-green.log`, and `task-6-red.log` identify this honestly. Verify-a4 exposed quoted/escaped V2 `agents.max_threads` and inline-commented managed-cap removal gaps. The repair's genuine RED and GREEN outputs are in `task-4-red-green.log` and `task-4-doneclaim.json`: installer 330 pass/4 fail to 334 pass/0 fail (plus the existing platform skip), migration 77 pass/4 fail to 81 pass/0 fail, bundle freshness 2/0. Task 6 then states the precise V2 preservation exception. The later gate-a6 log binds the broad gates to e87691a6a. No separate signed all-rounds approval artifact was located in the permitted task evidence, so none is claimed.

## Local validation and isolation

Bun 1.4.0, committed installer build, actual plugin build, and scoped `tsgo` all returned 0. The initial and post-build tracked status were clean. The product/test/skill diff against starting HEAD stayed empty. Evidence-driver TypeScript diagnostics were corrected and the final result was `No diagnostics found`; shell drivers passed `bash -n`.

A broad pre-build LSP scan also reported 14 existing bootstrap source/test diagnostics for missing ast-grep exports and inferred-any callback parameters. Those paths are unchanged in the branch diff, and the requested package typecheck passed. They were not suppressed or repaired in this evidence-only task.

All QA scratch homes were removed with receipts. The outer guards confirm the actual user's config, not just the isolated script HOME:

Real `~/.codex/config.toml` SHA-1 before: `b012e531f5aa9fb1bce9003593c3eadf07081fcd`.

Real `~/.codex/config.toml` SHA-1 after: `b012e531f5aa9fb1bce9003593c3eadf07081fcd`.
