# Evidence - issue 6754: Low-risk document tasks are forced through high-cost visual QA

Branch: `fix/doc-tasks-visual-qa-6754` (base origin/dev @ 8c57e463e)
Worktree: `/home/viprix/projects/oom-wt-6754`

## WHAT WAS TESTED

1. **Drift-guard equality test (new, machine seam).** `packages/skills-loader-core/src/features/builtin-skills/skills.test.ts` gained one test asserting the builtin wrapper's `description` equals the shipped `visual-qa/SKILL.md` frontmatter `description` (parsed from the real artifact via `parseFrontmatter`). This is the repo-sanctioned seam for "shipped in two copies that must stay identical" (.omo/rules/test-discipline.md, PROMPT TESTS).
   - RED: with the SKILL.md description updated and the wrapper stale, the test fails on exactly that inequality (`red-drift-guard.log`).
   - GREEN: after syncing the wrapper copy (`green-drift-guard.log`, 24 pass / 0 fail).

2. **Focused unit gates, twice consecutively over the identical final tree** (`gates-round-a.log`, `gates-round-b.log`):
   - `bun test packages/skills-loader-core` -> 232 pass / 0 fail (both rounds)
   - `bun test packages/prompts-core` -> 26 pass / 0 fail (both rounds; includes the bundled-content === on-disk-file export contract)
   - `bun test packages/omo-opencode/src/shared-skills-package.test.ts packages/omo-opencode/src/features/builtin-skills/skills.test.ts packages/omo-opencode/src/config/schema/agent-names.test.ts` -> 25 pass / 0 fail (both rounds)
   - `bunx tsgo --noEmit -p <pkg>` exit 0 for skills-loader-core, prompts-core, omo-opencode (both rounds)
   - `GIT_MASTER=1 git diff --check` clean (both rounds)
   - Hygiene grep `as any|@ts-ignore|console.log` over every changed path: 1 total hit, pre-existing (sisyphus default.ts anti-pattern line quoting `as any` as forbidden); ZERO hits on added lines.

3. **Real-surface loader QA under sandboxed env** (`qa-transcript.log`, driver `qa-loader-proof.ts`, harness `run-qa.sh`): drove the REAL consumers - `loadSkillsFromDir(scope:"shared")` over the shipped shared-skills dir, `createBuiltinSkills()` (agent prompt-assembly path), and prompts-core bundled variant loading - inside an isolated XDG/HOME/CODEX_HOME sandbox. 14/14 checks pass: visual-qa loads with the new frontmatter tier clause and Step 0 body gate; wrapper description equals shipped frontmatter; frontend loads post-scoping; all six ultrawork variants bundle+parse; the edited default QA row carries the risk-tier deferral in bundled content.

4. **Isolation proof** (`isolation-before.log` / `isolation-after.log`): stat + bounded fresh-file scan of real `~/.omo`, `~/.config/opencode`, `~/.codex`, `~/.cache/opencode` identical before and after the QA run. Sandbox writes were limited to three bun cache `.pile` files under the sandbox dir.

## WHY IT IS ENOUGH

The defect lives entirely in authored policy prose consumed by models plus one machine-consumed duplicated field. Per .omo/rules/test-discipline.md (PROMPT TESTS): a pure-prose change has no behavioral seam, so no prose-pin test exists or is allowed; the failing-first requirement does not apply there and this is disclosed here instead of manufacturing a pin. What CAN break at runtime is covered: frontmatter parsing (packaging + extraction suites), wrapper/frontmatter consistency (new equality guard, RED-proven by mutation), prompt bundling/export contracts (prompts-core suite), and end-to-end loading through the real loader paths (QA driver). The remaining verification channel for prose itself is review/QA-by-read of the diff.

## WHAT WAS OMITTED / NOT DRIVEN (honest scope)

- No live `opencode run` session was driven: the change alters no hook, tool, config schema, MCP, or runtime dispatch - only authored skill/policy wording and one wrapper constant. Loader-level proof above is the faithful channel; a live session would add model-call nondeterminism without exercising any new code path.
- Full root `bun test` suite not run per lane mandate scope (focused gates for touched areas); touched-package typechecks all exit 0.
- Other sisyphus model variants (gpt-5-4/gpt-5-5/kimi-*/grok/glm/claude-*): out of scope - per-model tuned prompts; the Step 0 chokepoint in visual-qa SKILL.md governs the verification tier regardless of which variant delegated. Adjudicated out-of-scope, not forgotten.
- senpi/codex ultrawork + ulw-loop directives: their visual-QA references are TUI-terminal-only; they never force static documents through visual QA. Out of scope.
- review-work/SKILL.md consumes an existing visual-qa verdict; forces nothing. Out of scope.
- No secrets, tokens, or credential-bearing logs were produced; nothing required redaction beyond this note.

## CHANGED FILES

- packages/shared-skills/skills/visual-qa/SKILL.md (Step 0 risk-tier gate + T0 fast path; Step 3/completion gate scoped to full tier; description clause)
- packages/skills-loader-core/src/features/builtin-skills/skills/visual-qa.ts (description mirrored)
- packages/skills-loader-core/src/features/builtin-skills/skills.test.ts (drift-guard equality test)
- packages/shared-skills/skills/frontend/SKILL.md (done-gate scoped to product UI)
- packages/skills-loader-core/src/features/builtin-skills/frontend/SKILL.md (byte-equivalent copy synced - existing extraction contract)
- packages/prompts-core/prompts/ultrawork/default.md, gemini.md, gpt.md (QA row defers to risk tier)
- packages/omo-opencode/src/agents/sisyphus/default.ts (risk-based carve-out in delegation bias)
