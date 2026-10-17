# QA evidence - issue #6755 visual-qa fresh-review termination bound

## WHAT WAS TESTED

- Failing-first regression contract test `tests/visual-qa-review-budget-contract.test.ts`
  parses the machine-consumed `<!-- visual-qa-review-budget-contract -->` JSON sentinel out of
  the real `packages/shared-skills/skills/visual-qa/SKILL.md` and asserts the four issue
  acceptance criteria: finite max review count (low-risk=1, normal<=3), non-blocking findings
  never schedule a new reviewer, blocker fixed inside budget earns focused fresh review,
  exhaustion returns `needs-human-review` (override only on explicit user request).
- Scoped suites after the fix:
  `bun test tests/visual-qa-review-budget-contract.test.ts tests/ulw-plan-review-convergence-contract.test.ts packages/skills-loader-core/src/features/builtin-skills packages/shared-skills/skills/visual-qa/scripts`
- `bun run typecheck` (tsgo --noEmit root + script + all workspace packages).
- Surface driven: skill prose contract consumed at runtime via
  `packages/skills-loader-core/src/features/builtin-skills/skill-file-loader.ts`
  (`loadSharedSkillTemplate("visual-qa")` reads this exact SKILL.md from disk; no TS change
  needed, frontmatter untouched so description lockstep holds).

## WHAT WAS OBSERVED

- RED before the edit: 5 fail / 0 pass ("missing visual-qa-review-budget-contract") -
  `failing-test-first.log`.
- GREEN after the edit: 96 pass / 0 fail / 286 expect() calls across 14 files, including the
  new contract test, the sibling ulw-plan #6128 convergence contract test, loader-core
  builtin-skills (byte-equality + frontmatter budget) and visual-qa CLI bundle tests -
  `scoped-tests.log`.
- Typecheck EXIT:0 across every workspace package - `typecheck.log`.

## WHY IT IS ENOUGH

The regression seam is the same machine-consumed sentinel pattern already shipped for the
sibling unbounded-loop defect (#6128, `tests/ulw-plan-review-convergence-contract.test.ts`):
the sentinel is policy a machine can parse, so the test pins behavior-relevant fields without
prose-pinning (test-discipline compliant). The runtime propagation path is proven by the
existing byte-equality suite staying green (template is loaded from the edited file at
runtime). Remaining risk is limited to Step 5 reference-fidelity retry loop, which issue
#6755 leaves out of scope, and to start-work/ulw-plan adoption, explicitly deferred by the
issue.

## WHAT WAS OMITTED

No secrets, env dumps, tokens, or credentials appear in any captured log; outputs are plain
bun/tsgo runs. No live harness session was spawned because the change surface is authored
skill markdown plus a root-level contract test; the sanctioned verification for pure-prose
skill edits is the machine-consumed contract seam plus review (shared-skills AGENTS.md NOTES),
both satisfied here.
