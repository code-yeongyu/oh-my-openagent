# Shared Skills Release Blocker Evidence

PR: #5565
Branch: code-yeongyu/fix-shared-skills-release-blockers

## Scope

- Prove the shared-skills PR removes unprovenanced frontend references from the committed tree while keeping materialization reproducible from pinned upstream submodules.
- Prove the legacy `ultraresearch` alias is visible through the Codex skill sync path.
- Commit reviewer-inspectable evidence for the already-green PR.

## Evidence

- `submodule-status.txt`: initialized the four frontend provenance upstream submodules at the pins recorded in `ATTRIBUTION.md`.
- `materialize-frontend-refs.txt`: strict materialization wrote 147 frontend reference files from submodules for local QA only.
- `shared-skills-focused-tests-rerun.txt`: `bun test packages/shared-skills/{depersonalization-gate,frontend-thirdparty-manifest,materialize-frontend-refs,provenance-gate,upstreams}.test.ts`, 20 pass / 0 fail.
- `node-resolution.txt`: confirms `@oh-my-opencode/shared-skills` resolved to this PR worktree during sync QA.
- `sync-skills-materialize.txt`: regenerated the local ignored Codex plugin skill tree before sync assertions.
- `codex-sync-skills-test.txt`: `node --test packages/omo-codex/plugin/test/sync-skills.test.mjs`, 15 pass / 0 fail, including the `ultraresearch` alias.
- `codex-qa-common-self-check.txt`: Codex QA isolation harness self-check passed; real `~/.codex/config.toml` unchanged.
- `opencode-qa-common-self-check.txt`: OpenCode QA common harness self-check passed.
- `github-checks.json`: GitHub checks for PR #5565 were all pass/skipping at capture time.
- `git-diff-check.txt`: whitespace/conflict-marker check passed.
- `git-status-before-stage.txt`: pre-stage status for this evidence-only follow-up.

## Notes

The materialized frontend references and generated Codex plugin skill tree were used only as local QA inputs. They are ignored/generated surfaces and are not part of this PR's tracked source diff.
