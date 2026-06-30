# Codex App-Server QA Limitation

Full first-party Codex app-server QA was attempted for this workflow-selector
change, but the run failed before Codex launched.

Artifact:
`.omo/evidence/20260627-workflow-selector-esm-spy/codex-qa-app-server-drive-plugin.txt`

Command:
`OMO_CODEX_AUTO_WORKFLOW=1 bash .agents/skills/codex-qa/scripts/app-server-drive.sh --plugin --prompt <debug prompt> --expect sessionStart,userPromptSubmit`

Observed blocker:
the isolated local plugin install ran `packages/omo-codex/plugin/scripts/sync-skills.mjs`
and failed with `ENOENT` opening
`packages/omo-codex/plugin/skills/ast-grep/SKILL.md`. This happens before
`codex app-server` starts, so no live Codex hook notifications can be captured
from that run.

Why the narrower QA is sufficient for this PR:
the production hook behavior is unchanged except for an injectable runtime seam
used by tests. The focused package test reproduces the release blocker and then
passes after replacing the ESM namespace spy. The component CLI proof exercises
the real built workflow-selector CLI for `hook user-prompt-submit` with
`OMO_CODEX_AUTO_WORKFLOW=1` and asserts the observable auto-workflow context. The
bundled CLI contract test confirms all built component CLI entrypoints, including
workflow-selector, remain self-contained and runnable through the published hook
contract. Those surfaces cover this narrow hook/test seam while the unrelated
generated skill sync issue is left out of scope.
