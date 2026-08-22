# Issue 7114 Senpi QA evidence

## Scope

This evidence exercises the real Senpi 2026.8.22 binary through print-mode session replacement and
natural quit. It specifically covers the shutdown-triggered memory dream path fixed for #7114.

## Result

PASS. The seed and probe processes exited zero, the parsed assistant response was exactly `OK`, no
`stale extension ctx` error appeared, and a durable `reflection-run-1` completion recorded
`trigger: dream` with `origin: shutdown`.

The completion terminal state was `failed / spawn_failed / model_not_visible`. That is expected for
this isolated provider: memory children deliberately use `--no-extensions`, so the parent-only mock
model cannot be visible to the child. The important lifecycle result is that the shutdown launch
crossed prelaunch and terminalized durably instead of failing on a captured extension API.

## Commands

1. `node packages/omo-senpi/scripts/qa/drive.mjs --self-test`
2. `node packages/omo-senpi/scripts/qa/drive.mjs`
3. `node .omo/evidence/omo-senpi-adapter/20260822-issue-7114-shutdown-context/shutdown-context-e2e.mjs`

The generic driver proved real-plugin execution and credential isolation but its unrelated
comment-checker lane failed; see `generic-driver.txt`. The dedicated issue driver is the applicable
product gate and passed; see `shutdown-context-result.json`.

## Isolation and artifacts

- Passing sandbox: `C:\Users\dajiaohuang\AppData\Local\Temp\omo-senpi-qa-eZiiY0`
- Earlier red sandbox: `C:\Users\dajiaohuang\AppData\Local\Temp\omo-senpi-qa-Sd5cqJ`
- Generic-driver sandbox: `C:\Users\dajiaohuang\AppData\Local\Temp\omo-senpi-qa-pbznS9`
- `realSenpiUntouched`: true
- Real Senpi changed paths: none detected
- Real `~/.omo/memory`: not used; the driver set `OMO_MEMORY_HOME` inside the sandbox
- Passing child terminal record: `reflection-run-1.json`, pending delivery for the next live session

## Cleanup receipt

Every listed sandbox root and both subsequent revalidation roots were resolved under the system
temporary directory and removed. The generic driver left one orphaned LSP daemon (`PID 22460`)
holding its project directory; its command line was verified to target this worktree's staged Senpi
LSP daemon, it was terminated, and the remaining sandbox was then removed. Final existence checks
returned false for every sandbox root.

## Residual risk

The isolated model cannot prove a successful child model response because discovery-disabled
children cannot load the parent-only mock extension. It does prove the reported lifecycle boundary:
the real quit path now records and terminalizes the shutdown reflection without stale context/API
access. Focused runner integration tests cover successful children and merge behavior separately.
