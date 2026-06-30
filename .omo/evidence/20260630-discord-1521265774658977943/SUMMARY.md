# QA Evidence Summary

Issue source:
- Discord message `1521265774658977943`; raw content intentionally omitted.
- Sanitized issue summary: `discord-sanitized-summary.md`.

Change:
- `omo doctor` now adds Bun blocked-postinstall recovery guidance when the loaded OpenCode plugin is outdated.
- The guidance tells users to inspect `bun pm untrusted` and trust only the OMO package plus the known postinstall helper package.

RED / reproduction evidence:
- `red-system-doctor-trust.txt`: initial RED attempt captured the missing test dependency blocker before the behavioral reproduction could run.
- `red-system-doctor-trust-after-install.txt`: behavioral RED reproduced the outdated-plugin fix text without Bun trust guidance after the simulated update/install state.

GREEN evidence:
- `doctor-tests-v5.txt`: focused doctor system test passed, including the new trust-guidance assertion.
- `typecheck-v5.txt`: `bun run typecheck` exited 0.
- `bun-test-full-v5.txt`: compact full `bun test` summary; stdout body intentionally omitted from the committed artifact while preserving counts, duration, and exit code.
- LSP diagnostics on `system.ts` and `system.test.ts`: no diagnostics found.

Manual QA:
- `manual-qa-doctor-trust-invocation-v3.txt`: drove `bun dist/cli/index.js doctor --platform opencode` with isolated `OPENCODE_CONFIG_DIR` and XDG dirs.
- Observed the outdated-plugin fix text include `bun pm untrusted` and `bun pm trust oh-my-openagent @code-yeongyu/comment-checker`.
- Isolation proof: real OpenCode session count stayed `5737` before and after.
- Cleanup: removed `/tmp/omo-doctor-trust-rerun-v3-Kvd7vG`.

Omitted:
- Raw Discord message text and any private context were not copied into artifacts or PR text.
- Earlier intermediate wrapper attempts remain on disk but are not part of the committed evidence set.
