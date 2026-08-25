# F3 final verification: real manual QA

**Verdict: F3: FAIL**

Date: 2026-08-10  
Branch: `feat/memory-v2-active-learning`  
Surface: freshly built worktree extension loaded by the worktree-local `node_modules/.bin/senpi`  
Isolation: throwaway `HOME`, `XDG_CONFIG_HOME`, `SENPI_CODING_AGENT_DIR`, session directory, and `OMO_MEMORY_HOME`; all removed after the run.

## Method

1. Built the extension with the exact required command:
   `node packages/omo-senpi/plugin/scripts/build-extension.mjs`.
2. Drove seven accepted turns in one resumed `senpi -p --mode json` session with a deterministic live mock provider.
3. Drove `/dream --recent 1` and `/people Mina` through an isolated interactive senpi PTY because print mode sends slash-prefixed input to the model instead of dispatching registered commands.
4. Subscribed with bounded `fs.watch` observers before the fourth settled turn and before `/dream`; no fixed sleeps or polling delays were used.
5. Captured the complete command transcript, injected system prompts, session JSONL, and isolated memory-repo log.
6. Restored generated bundles, killed/closed every spawned surface, and removed the complete isolated root.

## Root blocker observed at the packaged surface

The build itself exited successfully, but the resulting live extension rejected the memory-v2 scenario config:

```text
Warning: omo-senpi: configuration migration: Migration validation failed ...
memory.reflection: Invalid input, memory: Invalid input
Warning: omo-senpi: configuration diagnostics: Invalid omo config ...
```

The loaded memory prompt also carried the older compiled reminder text, while the branch source carries the memory-v2 reminder. The freshly built `plugin/extensions/omo.js` contained:

```text
Reminder: <projection> contains the local path of the memory file projection.
```

but `packages/memory-core/src/compile/compile.ts` contains:

```text
Reminder: <projection> holds local paths of memory projections.
```

This is evidence that the required extension build did not produce a packaged runtime matching the branch's current memory-v2 source. The QA therefore tested the actual generated bundle as required and did not substitute source-module tests or fake a pass.

## Scenario verdicts

| Step | Verdict | Real observation |
|---|---|---|
| 1. Build current extension | **PASS** | All four extension artifacts built successfully. Build output: `build.txt`. Generated bundles were restored at teardown. |
| 2. Fresh seed commits persona + human | **PASS** | First live memory-tool create initialized the isolated repo. Commit `29706fa` (`chore: initialize local memory`) added both `system/persona.md` and `system/human.md`. See `memory-git-log.txt` and `results.json`. |
| 3. Nudge at two turns, then self-clear | **FAIL** | Two accepted no-save turns completed, but the injected system prompt never contained `2 user turns since your last memory save`. A subsequent direct memory-tool save committed (`3f36323`), and the following prompt had no nudge token, but self-clear is not independently proven because the nudge never armed. See `system-prompts.txt` and `transcript.txt` around the turn-3 and turn-5 checks. |
| 4. Facts after four settles | **FAIL** | Four settles and the memory save were observed. The bounded `fs.watch` received no facts `final.json`; there was no durable queue file, launch run, facts commit, or Mina card. The quick model layer was **available** as `omo-mock/mock-1` (the live TUI status shows that connected model), so this is not a category-unavailable degradation and no fallback proof is claimed. |
| 5. Soul edit notice | **FAIL** | The memory tool really committed a `system/persona.md` edit as `c0c1e0d` (`F3 soul edit notice`). Its tool result lacked `This was a soul edit...`, and the next injected prompt lacked `Soul updated by reflection`. See `transcript.txt` and `memory-git-log.txt`. |
| 6. `/dream --recent 1` | **FAIL** | In the real PTY, `/dream --recent 1` did not reserve a dream run and fell through to the mock model. The pre-armed bounded `fs.watch` received no reflection/dream `final.json`, so no outcome sentinel exists. The TUI also displayed the packaged config-validation failure. |
| 7. `/people` card | **FAIL** | Facts produced no person record, and `/people Mina` was not registered at the packaged surface; the PTY treated it as model input. Per the scenario rule, no person card was written directly because the quick model was available rather than genuinely unavailable. |
| 8. Evidence + teardown | **PASS** | Full transcript, prompt dump, session JSONL, repo log, structured results, and teardown receipt are present. The isolated root is absent, spawned process count is zero, F3 tmux session count is zero, and bundle status is clean. |

## Isolated memory-repo history

The complete log is in `memory-git-log.txt`. The observed commits were:

```text
c0c1e0d F3 soul edit notice
3f36323 F3 nudge self-clear save
cad1f89 F3 initialize isolated memory
29706fa chore: initialize local memory
```

No facts or dream commit landed.

## Evidence index

- `build.txt` - required extension build and generated-bundle dirty receipt.
- `run.txt` - full stdout/stderr from the final scripted QA run, including PTY raw output.
- `transcript.txt` - full scenario transcript assembled by the driver.
- `system-prompts.txt` - complete injected system prompts for every model invocation.
- `session.jsonl.txt` - complete isolated senpi session JSONL.
- `session-files.txt` - isolated session file inventory before teardown.
- `memory-git-log.txt` - full isolated memory-repo git log with paths.
- `results.json` - machine-readable check results (`24` checks, `9` failures).
- `qa-driver.mjs` - deterministic scenario driver; uses bounded `fs.watch`, not sleeps.
- `teardown.txt` - bundle restoration, process/tmux cleanup, and isolated-root removal receipt.

## Teardown receipt

```text
bundle_status=clean
isolated_root_present=no
spawned_processes=0
f3_tmux_sessions=0
receipt=PASS
```
