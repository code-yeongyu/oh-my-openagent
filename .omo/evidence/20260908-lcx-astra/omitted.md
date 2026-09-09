# What was omitted and what remains unresolved

## Deliberate exclusions

- No product source, product test, shared skill, installed skill, or committed generated bundle edits. The required builds regenerated outputs; tracked files remained unchanged.
- No local `bun test` or `bun run test:codex`. Remote results cited here were executed by the earlier tasks and retained with their revisions, host identities, failed runs and cleanup receipts.
- No `codex exec`, `lazycodex doctor`, TUI prompt, real model API turn, model-driven work or agent spawning. The only live model provider was the codex-qa local mock with `model="mock-model"` forced by the existing client.
- No real auth files, credential files, account secrets, private environment dumps or real `.omo` contents were read or copied. The only access to the real Codex config was the required before/after checksum operation.
- No edits to the main checkout, no release/publish, no marketplace mirror push, no admin override, no squash/rebase merge, and no merge by this child. PR CI/review/merge belongs to the orchestrator.
- No new prose-pinning tests. Existing raw SessionStart evidence was matched to the shipped body; docs and preset mapping were read as prose.
- No fresh broad remote fanout: the applicable gate evidence already existed at identical product/test bytes. No fleet member was silently omitted from a new fanout because this task initiated none.

## Unresolved observations, not waived checks

The malformed-config negative case failed: installer exit 0 and rewritten config, not the plan's expected nonzero refusal with unchanged bytes. Its seed, resulting TOML, checksums and full installer log are retained. No baseline comparison was performed, so the defect is not attributed to or excused as pre-existing.

The plugin app-server script returned nonzero at its 90000ms deadline. The requested rules and ultrawork start/completion pairs were present with completed status, but the turn never reported completion and no mock assistant text was returned in that run. The bare self-test did complete. No larger timeout, blind retry or component exclusion was used.

The cache/source hook-count equality assertion initially failed with 19 versus 21. Readback of the existing installer explains exactly two Windows-only Git Bash hooks removed from the non-Windows cache. The installed marketplace snapshot still has the source's 21 hooks. Both counts are retained; active-cache equality is not represented as a pass.

The broad LSP scan reported missing ast-grep exports and inferred-any parameters in unchanged bootstrap source/tests. Scoped package `tsgo` passed. Evidence-driver typing errors were corrected without suppression; final driver diagnostics were clean. There is no Markdown LSP configured, so narrative evidence is reviewed by readback, and JSON/shell artifacts use parsers and shell syntax checks.

## Evidence provenance and retention

The task-N logs include historical failures, later repairs and failing-first reconstructions. Only the final, explicitly identified results are used as successful evidence. The available verify-a3/verify-a4 repair records and gate-a6 results are cited; an all-rounds approval or post-PR approval is not invented from those records.

Remote source checkouts were removed by the original runners. The existing gate log notes small receipt directories retained on mengmotaMac and gorky; this child did not delete those remote artifacts. Local QA homes were removed after capture. No provider secrets or auth payloads were included in the new evidence; hook IDs and sandbox paths are retained because they identify the observed runtime surface.

Real `~/.codex/config.toml` SHA-1 before: `b012e531f5aa9fb1bce9003593c3eadf07081fcd`.

Real `~/.codex/config.toml` SHA-1 after: `b012e531f5aa9fb1bce9003593c3eadf07081fcd`.
