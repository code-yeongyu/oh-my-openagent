# Why this evidence is enough for the reported claims

The evidence supports opening a reviewer-readable PR for the implemented Astra defaults, but it does not establish that every todo-7 acceptance condition is green or that the PR is ready to merge. The orchestrator owns CI, review, disposition of the failures below, and merge.

## Coverage of the implemented behavior

The three catalog sources have parity evidence rather than independent unchecked edits. Installer and migration tests cover no insertion, managed-value removal, preserved user caps, quoted/escaped TOML keys, inline comments and V2 model detection. The rebuilt committed bundle was tested remotely and regenerated locally without any tracked change. The final installer QA used that bundle through its real wrapper, not direct source-only helper calls.

The fresh and legacy installs cover root Astra/600k/high/plan-xhigh values, 12 installed Astra agent TOMLs and role blocks, and absent cap keys. The custom-model/cap and customized-explorer installs cover the preservation boundary. Installed manifest arrays are checked against the source at both surfaces: the full marketplace snapshot and the platform-filtered runtime cache. The initial incorrect cache-count assumption remains recorded as a failure instead of being hidden.

Rules-engine and canonical rules-component suites cover variant selection and budget behavior. The raw SessionStart captures contain the current shipped body in full, avoiding a prose-pinning test. The corrected PostCompact scenario isolates project-rule recovery from the never-truncated Hephaestus body and measures the large-window versus unknown-model fallback behavior on the actual recovery path.

The real Codex app-server notifications demonstrate live registration and execution of the rules and ultrawork hooks. Matching started/completed records use the same run IDs and completed status, rather than relying on log text alone. The model provider is the skill's fixed local mock; this proves plugin wiring, not real Astra quality or adherence to instructions.

Remote gates cover the shared rules engine, installer, generated bundle, plugin suite, full Codex gate and markdown audit. Only evidence changed between e87691a6a, b8485e334 and the starting HEAD, so their product/test bytes are applicable. The later gorky A/B results provide concrete evidence for classifying the earlier 20-second installer timeout as load-sensitive; they do not erase the failed executions.

## Limits that prevent an all-green conclusion

1. The plan's malformed-config refusal criterion is not met. The branch installer returned 0 and replaced the invalid model string. No source edits were authorized for this ship task, and the baseline behavior was not measured.
2. The plugin app-server script did not finish a mock turn within its unchanged deadline. Required hooks completed, but a full-turn pass is not claimed.
3. Runtime-cache hook count is 19 on macOS, while the source and installed marketplace snapshot each have 21. The delta is exactly the existing Windows-only Git Bash filter. A requirement for unfiltered runtime-cache equality would need an explicit contract correction, not an invented pass.
4. Broad bootstrap LSP diagnostics remain outside the changed paths; the requested scoped typecheck is green. No complete post-PR CI/review result is part of this evidence.

These are visible review inputs, not waived gates. No failing test was removed or skipped, no timeout was increased, no retry loop was added, and no product behavior was changed to obtain greener evidence.

## Approach and assumptions

Two paths were considered: duplicate all earlier remote/raw-hook runs, or reuse content-matched committed evidence and run the missing final-bundle installs plus first-party hook probe. The latter was chosen because the product bytes were unchanged, it avoids adding host-load noise and prohibited local test work, and it directly addresses the previously deferred install cases. Raw SessionStart reuse was explicitly allowed by the task and verified against the current shipped bodies.

Two installed plugin manifests are reported because the platform-filtered cache and unfiltered marketplace snapshot are distinct real installer outputs. Neither is silently substituted for the other. The no-source-edit boundary takes priority over repairing newly observed failures during this child task. The stop condition is an open PR, not a merge or a claim of full QA success.

## Isolation proof

Fresh CODEX_HOME, HOME and XDG directories prevent access to real user plugin state, `.omo` state and auth. The scripts' sandbox `ABSENT` checks are supplemented with the outer real-config checksum guards and cleanup receipts.

Real `~/.codex/config.toml` SHA-1 before: `b012e531f5aa9fb1bce9003593c3eadf07081fcd`.

Real `~/.codex/config.toml` SHA-1 after: `b012e531f5aa9fb1bce9003593c3eadf07081fcd`.
