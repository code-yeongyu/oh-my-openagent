# Why this evidence is enough for PR review

The change softens the LazyCodex gate rather than removing it. Gate validation, criterion coverage, manual QA, iteration evidence, unknown-author rejection, and explicit-demand reviewer escalation remain. Existing tests cover the unchanged senpi contract. The evidence combines distinct failure-detection surfaces:

1. Real scratch-project checkpoint CLI runs prove the optional codeReview and author/input contracts. They can fail on state, artifact placement, schema validation, and command wiring, not only helper functions (`task-8-gate.log`; todo 9's supplemental CLI result in `task-14-verifier-rounds.json`).
2. Raw hook payloads prove admission recording/denial, clean-session isolation, ordinary-versus-ulw prompt behavior, and Stop/SubagentStop separation. Installed-component replacement probes close the earlier source-only installation gap (`task-10-spawn-guard.log`, `task-11-directive.log`, `task-12-continuation.log`).
3. Six remote commands at the same pushed product SHA cover component behavior, manifest contracts, generated-copy identity/drift, installer freshness, and the full Codex unit gate. Remote cleanup receipts are present. The later commits change only evidence, so the tested product tree remains applicable (`task-gate-b5-receipt.json`).
4. Fresh installer and plugin builds leave the tracked tree clean. Fresh isolated installation proves landing, and a real Codex app-server using only the local mock proves started/completed notifications from the installed rules and ultrawork hooks. Unit results are not being substituted for this live-harness proof (`task-14-build.log`, `task-14-app-server.json`).
5. Six verifier rounds preserve discoveries and their resolutions. The final verifier confirmed the remaining todo-10 and todo-12 evidence while preserving earlier confirmations. Their recorded limits remain visible.

## Deliberate choices

Reusing the exact-SHA remote gate is preferable to repeating all tests for an evidence-only commit: Git confirms no product delta, and the transcript checksum remains identical. Fresh local install/app-server proofs add the previously missing deployment and real-harness evidence instead.

A disposable copy of the QA scripts was chosen over editing the repository skill or introducing a new protocol driver. Entrypoints, client, and mock are byte-identical; only the temporary common helper changes readiness and isolation. FIFO readiness is registered before startup and bounded by a timeout. This preserves the actual mock/model/hook integration without relying on polling delays. The runner and helper diff are recorded for review.

## Not an unconditional ship pass

The requested native installed-cache count of 21 is **not satisfied on macOS**: the existing installer filters two Windows-only Git Bash hooks, yielding 19. The installed marketplace snapshot retains all 21, and both manifests have the intended admission-hook inclusion and continuation-hook exclusion. This finding is explicit in `task-14-ship.log`, which retains exit 1 rather than hiding the mismatch. No product edit or platform simulation was used to manufacture a 21-hook native result.

This is enough to open an accurately described PR for orchestrator review, not to claim every todo-14 acceptance criterion or a merge gate passed. CI, review-work/Cubic, the native-count contract decision, and merge remain with the orchestrator. Mock-only QA does not establish how an autonomous model follows the relaxed prose in real work.

Real `~/.codex/config.toml` SHA-1 before: `b012e531f5aa9fb1bce9003593c3eadf07081fcd`; after: `b012e531f5aa9fb1bce9003593c3eadf07081fcd`. Real `~/.omo` and auth files were not QA inputs or outputs.
