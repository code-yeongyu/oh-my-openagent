import type { BuiltinSkill } from "../types"

const QUALITY_GATE_SKILL_NAME = "quality-gate"

const QUALITY_GATE_SKILL_DESCRIPTION =
  "Automated quality verification after code changes: lint (Biome), typecheck, test execution, build verification. Triggers: 'verify', 'quality', 'lint', 'check', 'validate', 'quality gate', 'run checks'."

export const qualityGateSkill: BuiltinSkill = {
  name: QUALITY_GATE_SKILL_NAME,
  description: QUALITY_GATE_SKILL_DESCRIPTION,
  template: `# Quality Gate — Mandatory Verification After Code Changes

## THE RULE

Every code change (write, edit, refactor) MUST be verified before marking complete.

**The quality-gate hook auto-lints .ts files after write/edit tool calls.** You will see lint warnings in the tool output. Address them.

But the hook only covers linting. YOU must run the full verification suite.

---

## VERIFICATION CHECKLIST (EVERY CODE CHANGE)

Run these in order. ALL must pass before marking task done.

### 1. Lint (automatic + manual)
\`\`\`bash
bun run lint          # Full codebase lint
bun run lint:fix      # Auto-fix what Biome can
\`\`\`
The quality-gate hook runs Biome on each .ts file you write/edit. Fix warnings as they appear.

### 2. Type Check
\`\`\`bash
bun run typecheck     # tsc --noEmit
\`\`\`
Must exit 0 with no errors. Never suppress with \`as any\` or \`@ts-ignore\`.

### 3. Tests
\`\`\`bash
bun test              # All tests must pass
\`\`\`
If you changed behavior, write/update tests FIRST (see tdd-enforcer skill).

### 4. Build
\`\`\`bash
bun run build         # ESM + declarations
\`\`\`
Must exit 0. Verify dist/index.js exists.

---

## EVIDENCE FORMAT

Report verification results as:
\`\`\`
✅ bun run lint — 0 issues
✅ bun run typecheck — no errors
✅ bun test — 42 passed, 0 failed (3.2s)
✅ bun run build — success
\`\`\`

If ANY step fails:
1. STOP. Do not report done.
2. Fix the failure.
3. Re-run ALL verification steps.
4. Report done only when ALL pass.

---

## HOOK BEHAVIOR

The quality-gate hook in tool.execute.after:
- Runs Biome on .ts/.tsx/.js/.jsx files after write/edit/multiedit
- Appends lint warnings to tool output
- Non-blocking (never halts execution)
- 10s timeout per file

You will see output like:
\`\`\`
⚠️ **Quality Gate** — lint issues in \`file.ts\`:
[biome output]
Run \`bun run lint:fix\` to auto-fix, or address manually.
\`\`\`

Fix these inline when possible. For bulk fixes, run \`bun run lint:fix\`.

---

## ANTI-PATTERNS

| Anti-Pattern | Why It's Wrong |
|-------------|----------------|
| Skip lint because "it's just style" | Lint catches real bugs (noUnusedVariables, noDoubleEquals) |
| Skip typecheck because "it compiled before" | Types change with every edit |
| Skip tests because "it's a small change" | Small changes break things |
| Skip build because "tests pass" | Build validates exports and declarations |
| Report done without running verification | Never trust — always verify |
`,
}
