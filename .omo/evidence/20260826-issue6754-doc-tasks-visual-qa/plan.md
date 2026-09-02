# Plan - issue 6754: Low-risk document tasks are forced through high-cost visual QA

Worktree: <repo-root> (branch fix/doc-tasks-visual-qa-6754, base origin/dev @ 8c57e463e)

## Root cause (verified by reading the real chain, not from memory)

The visual-QA policy chain classifies surfaces by ARTIFACT TYPE, never by RISK.
Four authored policy artifacts hard-mandate the dual-oracle / independent-reviewer
workflow for ANY rendered surface, so "summarize local docs into Markdown + a
standalone HTML report" escalates into browser capture + 2 oracle reviewers +
completion-gate loops:

1. `packages/shared-skills/skills/visual-qa/SKILL.md` (the chokepoint every route
   flows through): description says "MUST USE after building/changing any UI" with
   paginated documents in scope; Step 3 says independent review is "REQUIRED before
   any 'done' claim"; completion gate is an unconditional hard stop. No risk gate
   anywhere in the body.
2. `packages/shared-skills/skills/frontend/SKILL.md` line ~139: "Done is the
   `/visual-qa` dual-oracle gate, not your own glance." - unconditional.
3. `packages/prompts-core/prompts/ultrawork/{default,gemini,gpt}.md` QA table row
   "Changes UI rendering or a TUI/terminal layout": mandates loading visual-qa and
   "get the dual read-only verdict" for any UI rendering, including generated
   static HTML reports. (codex.md has no such row; glm/planner have no such row.)
4. `packages/omo-opencode/src/agents/sisyphus/default.ts`: delegation bias
   ("Default Bias: DELEGATE...") classifies only by size/complexity, never risk,
   so doc tasks get pushed into visual-engineering + frontend/visual-qa skills.

## Fix strategy

Risk, not file extension, selects the verification tier. The classifier lives at
the chokepoint (visual-qa SKILL.md Step 0) as a shared T0 static-document fast
path; each forcing point is scoped so it defers to the tier instead of overriding it.

### Edits

| # | File | Change |
|---|------|--------|
| 1 | packages/shared-skills/skills/visual-qa/SKILL.md | Add "Step 0 - Classify the verification tier by risk": T0 static-document fast path (read source -> create artifacts -> ONE basic render/link check at requested viewport -> deliver; no independent reviewers; no print/sub-390px/accessibility/reference-fidelity passes unless requested; explicit budget terms quick/simple/"just summarize" select T0 when no safety boundary applies). Escalation triggers to full tier: production-grade/independent QA asked, security/accessibility/reference-fidelity boundary, interactive surface, production audience. Scope Step 3 lead-in + completion gate to full tier. Purpose bullet notes tier follows risk. Frontmatter description gains one scoping clause. |
| 2 | packages/skills-loader-core/src/features/builtin-skills/skills/visual-qa.ts | Mirror the description byte-for-byte (machine-consumed duplicate of frontmatter field; omo-opencode copy re-exports this file). |
| 3 | packages/skills-loader-core/src/features/builtin-skills/skills.test.ts (or co-located new test) | NEW drift-guard equality test: wrapper `description` === SKILL.md frontmatter `description` parsed from the real shared-skills artifact. Allowed seam per .omo/rules/test-discipline.md PROMPT TESTS: "shipped in two copies that must stay identical -> guard drift with ONE equality between the two real artifacts". RED captured against deliberately drifted state (mutation proof), GREEN after sync. |
| 4 | packages/shared-skills/skills/frontend/SKILL.md | Scope the done-gate bullet to product UI work; static non-interactive documents follow visual-qa's static-document fast path instead. |
| 5 | packages/prompts-core/prompts/ultrawork/default.md, gemini.md, gpt.md | Qualify the visual-qa QA-table row: full dual verdict for product UI/TUI changes; static non-interactive documents take the skill's fast path (one render/link check, no independent reviewers) unless production-grade QA was requested. Identical wording in all three (they are currently byte-identical rows). |
| 6 | packages/omo-opencode/src/agents/sisyphus/default.ts | After the delegation-bias line: low-risk document generation (summarize local content into Markdown/standalone report) is direct-execution work with one basic render/link check; verification effort scales with RISK, not file extension. |

### Test discipline compliance (why there is NO prose-pin test for the defect itself)

The defect lives entirely in authored prose consumed by models, not by code.
.omo/rules/test-discipline.md (PROMPT TESTS section, line 75): a pure-prose change
with no machine consumer has NO behavioral seam - write NO automated test; this is
the sanctioned exception to failing-first. The lane mandate's "test only
machine-consumed fields or runtime behavior" is honored via:
- NEW equality test over the ONE machine-consumed duplicated field I touch
  (description frontmatter vs wrapper constant).
- Existing machine tests stay green: shared-skills-package.test.ts (every skill
  parses), builtin catalog tests, prompts-core variant export test (bundled
  content === file on disk).

### Verification plan

- Focused gates, run TWICE over the identical final tree:
  - bun test packages/skills-loader-core packages/prompts-core
  - bun test packages/omo-opencode/src/shared-skills-package.test.ts packages/omo-opencode/src/features/builtin-skills/skills.test.ts packages/omo-opencode/src/config/schema/agent-names.test.ts
  - bunx tsgo --noEmit -p packages/skills-loader-core/tsconfig.json
  - bunx tsgo --noEmit -p packages/prompts-core/tsconfig.json
  - bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json
  - GIT_MASTER=1 git diff --check
  - GIT_MASTER=1 git grep -n "as any\|@ts-ignore\|console\.log" on changed paths (zero new hits)
- Real-surface QA under /tmp/opencode/issue-6754/ with sandboxed
  XDG_DATA_HOME/XDG_CONFIG_HOME/XDG_STATE_HOME/XDG_CACHE_HOME/HOME:
  drive the REAL loader path (skills-loader-core loadSkillsFromDir over the
  shipped shared-skills dir + createBuiltinSkills) proving visual-qa loads with
  the new frontmatter and template body containing the Step 0 tier gate;
  prove sandbox isolation before/after (real ~/.omo, ~/.config/opencode,
  ~/.codex, ~/.cache/opencode untouched - stat/digest evidence).
- Honest scope note: no live opencode session is driven because the change alters
  no hook/tool/config/runtime dispatch - it is authored policy prose plus one
  wrapper constant; loader-level runtime proof + QA-by-read is the faithful channel.

## Adjudication preview (final ledger lives in README.md)

- Other sisyphus model variants (gpt-5-4/5-5, kimi-*, grok, glm, claude-*):
  out-of-scope - per-model tuned prompts; the Step 0 chokepoint governs the tier
  regardless of which variant delegated; touching 14 files multiplies risk for no
  behavioral delta at the chokepoint.
- senpi/codex ultrawork + ulw-loop directives: out-of-scope - their visual-QA
  references are TUI-terminal-only, they never force static documents through
  visual QA.
- review-work/SKILL.md: out-of-scope - it consumes an existing visual-qa verdict,
  forces nothing.
