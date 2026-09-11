# What was omitted and remaining risk

- No product source changes in this ship task. The only non-evidence change is the generated installer stamp/version correction requested by the orchestrator. Existing executor and doctor changes were already pushed.
- No local `bun test`, no new remote test run, no retries of the pre-existing bin-link failures, and no test suppression. The remote gate remains non-green; mismatched Bun runner commands remain exit 1. The supplied Node receipts do not claim a new isolated Vitest run of the executor unit suite.
- No `codex exec`, no `lazycodex doctor`, no TUI prompt, and no real-model Astra turn. Live QA used the local mock provider; raw-pipe payloads used `gpt-6-astra` only as hook input. codex-cli 0.147.0 is below the documented Astra floor, so real Astra availability is not proven.
- The plan's installed-hook-count equality is unmet on macOS: source 21, installed 19 after the pre-existing Windows-only hook removal. No platform override or installer patch was used to manufacture a pass.
- No independent re-derivation of upstream `rust-v0.153.1` in this turn; the committed skill identifies its discovery command and backport commit. Doctor QA was by read only.
- The original volume's uncommitted logs were unavailable. The orchestrator's TCC incident account is recorded in `NOTE-volume-incident.md`; the volume was not repaired or modified.
- No real Codex auth files, environment dumps, credentials, or authorization headers were collected. Only the requested real config shasum was recorded. Synthetic raw-pipe payloads and the mock app-server summaries are retained, including their non-secret warning diagnostics.
- No new Python LSP dependency was installed when `basedpyright-langserver` was unavailable. The evidence helper was syntax-compiled and executed. The generated installer had clean LSP diagnostics, and the product package passed local tsgo.
- No source edits to codex-qa. Disposable copies used event-driven mock readiness to avoid polling; canonical temporary paths fixed an entry-guard no-op. Original invalid no-op receipts remain visible and are not counted as passes.
- No CI watch, merge, release, publish, marketplace push, or issue-closing action. These are outside this child's PR-creation stop condition. No merge override or squash option was used.

Residual product risk: the 40-character floor detects short placeholders, not fabricated long evidence; timestamp freshness depends on filesystem metadata. The stale check intentionally fails open when the transcript cannot be stat'ed. Existing containment, agent matcher, context-pressure bypass, and retry cap are not removed by this change.
