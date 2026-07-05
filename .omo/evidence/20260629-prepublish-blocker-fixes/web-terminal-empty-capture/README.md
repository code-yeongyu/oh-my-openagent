# Web Terminal Empty Capture Blocker Fix Evidence

Task: fix blocker #4 from `.omo/evidence/20260629-prepublish-heavy-review/final/blockers.md`: command mode must not exit 0 or report evidence paths when tmux capture is empty or failed.

## Scenario 1: RED regression proof
- Invocation: `bun test script/web-terminal-visual-qa.test.ts` before the production fix, with a new command-mode empty-capture test temporarily in that file.
- Binary observable: exit code `1`; failure shows expected exit `1` but helper returned `0`.
- Artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/web-terminal-empty-capture/red-empty-capture-test.log`
- Receipt: `.omo/evidence/20260629-prepublish-blocker-fixes/web-terminal-empty-capture/red-empty-capture-test.receipt.txt`

## Scenario 2: Focused automated regression tests
- Invocation: `bun test script/web-terminal-visual-qa.test.ts script/web-terminal-visual-qa-command.test.ts`
- Binary observable: exit code `0`; 10 tests pass, including `#given command mode captures an empty tmux pane #when rendering #then the helper rejects the evidence`.
- Artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/web-terminal-empty-capture/green-focused-tests.log`
- Receipt: `.omo/evidence/20260629-prepublish-blocker-fixes/web-terminal-empty-capture/green-focused-tests.receipt.txt`

## Scenario 3: TypeScript script project check
- Invocation: `bun run typecheck:script`
- Binary observable: exit code `0`; `tsgo --noEmit -p script/tsconfig.json` passed.
- Artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/web-terminal-empty-capture/typecheck-script.log`
- Receipt: `.omo/evidence/20260629-prepublish-blocker-fixes/web-terminal-empty-capture/typecheck-script.receipt.txt`

## Scenario 4: Live tmux-backed command success path
- Invocation: `node script/qa/web-terminal-visual-qa.mjs --title "Live Command QA" --command "printf 'webterm-live-ok\\n'" --source-label "printf live marker" --evidence-dir .omo/evidence/20260629-prepublish-blocker-fixes/web-terminal-empty-capture/live-command-artifacts --dwell-ms 500 --no-browser`
- Binary observable: exit code `0`; `terminal.txt` and `terminal-ansi.txt` are each 86 bytes; `terminal.txt` contains `webterm-live-ok` and `[web-terminal-visual-qa exit:0]`.
- Cleanup receipt: metadata records `tmux kill-session`; `tmux ls` check found no remaining `omo_webterm` session.
- Artifacts: `.omo/evidence/20260629-prepublish-blocker-fixes/web-terminal-empty-capture/live-command-artifacts/terminal.txt`, `terminal-ansi.txt`, `terminal.html`, `metadata.json`
- Checks: `.omo/evidence/20260629-prepublish-blocker-fixes/web-terminal-empty-capture/live-command-checks.txt`
- CLI stdout/stderr capture: `.omo/evidence/20260629-prepublish-blocker-fixes/web-terminal-empty-capture/live-command-cli.log`

## Scenario 5: Empty tmux capture CLI rejection
- Invocation: `PATH=<fake-empty-tmux> node script/qa/web-terminal-visual-qa.mjs --title "Empty Command QA" --command "printf 'hidden\\n'" --source-label "fake empty tmux" --evidence-dir .omo/evidence/20260629-prepublish-blocker-fixes/web-terminal-empty-capture/empty-command-artifacts --dwell-ms 1 --no-browser`
- Binary observable: helper invocation exits `1`; stderr contains `tmux capture was empty`; no evidence files are written.
- Cleanup receipt: fake tmux temp dir removed with `rm -rf`; this scenario used no live tmux session.
- Artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/web-terminal-empty-capture/empty-command-cli.log`
- Checks: `.omo/evidence/20260629-prepublish-blocker-fixes/web-terminal-empty-capture/empty-command-checks.txt`

## Scenario 6: File-size and checker hygiene
- Invocation: pure LOC checks for changed files.
- Binary observable: `script/qa/web-terminal-visual-qa.mjs` 228, `script/web-terminal-visual-qa.test.ts` 224, `script/web-terminal-visual-qa-command.test.ts` 75; all under the 250 pure LOC ceiling.
- Artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/web-terminal-empty-capture/loc-check.txt`
- Omitted: `scripts/typescript/check-no-excuse-rules.ts` was not present in this checkout; recorded in `.omo/evidence/20260629-prepublish-blocker-fixes/web-terminal-empty-capture/no-excuse-checker-unavailable.txt` and substituted `bun run typecheck:script` plus LOC checks.

## Why this is enough
The RED test proves the pre-fix behavior accepted empty command-mode captures. The new regression test and direct fake-tmux CLI proof cover the blocker path with a non-zero, clear error and no bogus evidence files. The live tmux command proof covers the non-empty success path and confirms artifacts remain non-empty while cleanup completes.

## Residual risk
PNG capture was intentionally omitted with `--no-browser` because the blocker is command-mode tmux transcript acceptance, not browser rendering. Existing file-replay/browser-render tests remain covered by the focused helper suite.
