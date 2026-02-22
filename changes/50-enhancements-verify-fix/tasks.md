# Tasks: 50-Enhancements Verify Fix

> Fix 32 FAIL + 5 PARTIAL tasks from rt-verify audit.
> Evidence: `changes/50-enhancements-rt-verify/findings.md`
> Original spec: `changes/50-enhancements/tasks.md`

---

## Wave 0: Uncomment Disabled Hooks (4 tasks)

> These hooks are registered via `isHookEnabled()` but their `await` calls are commented out
> in `src/index.ts` with `// TEMPORARILY DISABLED FOR DEBUGGING - Phase 3 hook`.
> **IMPORTANT**: Uncomment one at a time. Run `bun test` after each.

### - [x] 0.1: Enable secretScanner hook (Task 1.2)

**What**: Uncomment `src/index.ts:934`

**Files**:
- Modify: `src/index.ts` — uncomment line 934

**Acceptance Criteria**:
- [ ] Line 934 uncommented
- [ ] `bun test src/hooks/secret-scanner/` → PASS
- [ ] `bun test` → all pass

**Commit**: `fix(hooks): enable secret-scanner hook (was commented out)`

---

### - [x] 0.2: Enable knowledgeInjection hook (Task 10.3)

**What**: Uncomment `src/index.ts:945`

**Files**:
- Modify: `src/index.ts` — uncomment line 945

**Acceptance Criteria**:
- [ ] Line 945 uncommented
- [ ] `bun test` → all pass

**Commit**: `fix(hooks): enable knowledge-injection hook (was commented out)`

---

### - [x] 0.3: Enable behaviorAnchor hook (Task 8.3)

**What**: Uncomment `src/index.ts:1063`

**Files**:
- Modify: `src/index.ts` — uncomment line 1063

**Acceptance Criteria**:
- [ ] Line 1063 uncommented
- [ ] `bun test` → all pass

**Commit**: `fix(hooks): enable behavior-anchor hook (was commented out)`

---

### - [x] 0.4: Enable verbosityController hook (Task 10.4)

**What**: Uncomment `src/index.ts:1064`

**Files**:
- Modify: `src/index.ts` — uncomment line 1064

**Acceptance Criteria**:
- [ ] Line 1064 uncommented
- [ ] `bun test` → all pass

**Commit**: `fix(hooks): enable verbosity-controller hook (was commented out)`

---

### Wave 0 Gate
- [ ] `bun test` — full pass
- [ ] `bun run typecheck` — 0 errors

---

## Wave 1: Wire Code Islands (17 tasks)

> Modules exist with tests but `src/index.ts` never imports/calls them.

### - [x] 1.1: Wire security-tiers (Task 1.3)
- Modify: `src/hooks/rules-injector/index.ts`

### - [x] 1.2: Wire role-rules (Task 1.4)
- Modify: `src/hooks/rules-injector/index.ts`

### - [x] 1.3: Wire handover-protocol (Task 3.2)
- Modify: `src/features/background-agent/manager.ts`

### - [x] 1.4: Wire context ordering (Task 3.4)
- Modify: `src/features/context-injector/collector.ts`

### - [x] 1.5: Wire MCP tool count warning (Task 4.2)
- Modify: `src/mcp/index.ts`

### - [x] 1.6: Wire MCP templates (Task 6.1)
- Modify: `src/mcp/index.ts`

### - [x] 1.7: Wire MCP lazy-loader (Task 6.2)
- Modify: `src/mcp/index.ts`

### - [x] 1.8: Wire MCP post-hook-trigger (Task 6.3) — Already exported from mcp/index.ts

### - [x] 1.9: Wire SKILL.md frontmatter parser (Task 7.1) — File missing, needs implementation
- Create: `src/features/builtin-skills/skill-parser.ts`
- Modify: `src/features/builtin-skills/skills.ts`

### - [x] 1.10: Wire relevance-scorer (Task 8.1) — File missing, needs implementation
- Create: `src/features/context-injector/relevance-scorer.ts`
- Modify: `src/features/context-injector/collector.ts`

### - [x] 1.11: Wire anti-pattern-tracker (Task 8.2) — File missing, needs implementation
- Create: `src/hooks/compaction-context-injector/anti-pattern-tracker.ts`
- Modify: `src/hooks/compaction-context-injector/index.ts`

### - [x] 1.12: Wire AST coverage checker (Task 9.2) — File missing, needs implementation
- Create: `src/hooks/tdd-guard/ast-coverage-checker.ts`
- Modify: `src/hooks/tdd-guard/index.ts`

### - [x] 1.13: Wire isolation-checker (Task 9.3) — File missing, needs implementation
- Create: `src/hooks/tdd-guard/isolation-checker.ts`
- Modify: `src/hooks/tdd-guard/index.ts`

### - [x] 1.14: Wire session-scorer (Task 11.3)
- Modify: `src/index.ts`

### - [x] 1.15: Wire /refactor dead-code (Task 12.1)
- Modify: `src/features/builtin-commands/templates/refactor.ts`

### - [x] 1.16: Wire agent-chain templates (Task 13.3)
- Modify: `src/features/builtin-commands/commands.ts`

### - [x] 1.17: Wire MCP health-checker (Task 15.1)
- Modify: `src/mcp/index.ts`

---

## Wave 2: Fix Default-Disabled (2 tasks)

### - [x] 2.1: Enable TDD real execution by default (Task 1.1)
- Modify: `src/hooks/tdd-guard/types.ts`

### - [x] 2.2: Enable preemptive compaction by default (Task 2.4)
- Modify: `src/config/schema.ts`

---

## Wave 3: Fix PARTIAL (5 tasks)

### - [x] 3.1: Strengthen Oracle decision framework (Task 3.1)
- Modify: `src/agents/oracle.ts`

### - [x] 3.2: Fix TDD status display (Task 11.2)
- Modify: `src/hooks/tdd-guard/types.ts`

### - [x] 3.3: Wire scenario presets (Task 12.3)
- Modify: `src/features/builtin-commands/commands.ts`

### - [x] 3.4: Add context-aware hook activation (Task 14.1)
- Create: `src/shared/context-detector.ts`
- Modify: `src/hooks/index.ts`

### - [x] 3.5: Use HookExecutor for graceful degradation (Task 14.3)
- Modify: `src/index.ts`

---

## Wave 4: Implement Missing (9 tasks)

### - [x] 4.1: Implement unified skill format (Task 2.2)
- Modify: All `src/features/builtin-skills/*/SKILL.md`

### - [x] 4.2: Implement PR diff context injector (Task 9.4)
- Create: `src/hooks/pr-context-injector/`

### - [x] 4.3: Implement multi-stage verification (Task 10.1)
- Create: `src/features/verification/`

### - [x] 4.4: Implement TDD template generator (Task 5.1)
- Create: `src/hooks/tdd-guard/template-generator.ts`

### - [x] 4.5: Implement unified test runner (Task 11.1)
- Create: `src/cli/test-runner.ts`

### - [x] 4.6: Implement Explore intent analysis (Task 13.2)
- Modify: `src/agents/explore-prompt.ts`

### - [x] 4.7: Implement Stop-stage final audit (Task 14.2)
- Create: `src/hooks/stop/final-audit-hook.ts`

### - [x] 4.8: Implement cross-agent verification (Task 15.3)
- Modify: `src/agents/oracle-prompt.ts`

### - [x] 4.9: Wire commit-size-checker (Task 15.2)
- Modify: `src/index.ts`

---

## Summary

| Wave | Tasks | Type | Risk |
|------|-------|------|------|
| 0 | 4 | Uncomment | Low |
| 1 | 17 | Wire imports | Low-Medium |
| 2 | 2 | Config defaults | Low |
| 3 | 5 | Harden partials | Medium |
| 4 | 9 | Full implementation | High |

**Total**: 37 tasks (32 FAIL + 5 PARTIAL)
