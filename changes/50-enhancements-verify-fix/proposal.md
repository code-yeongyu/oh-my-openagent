# Proposal: 50-Enhancements Verify Fix

## Problem Statement

The `50-enhancements` plan implemented 46 features, but runtime verification (`50-enhancements-rt-verify`) found that only 9 (20%) actually work at runtime. 32 tasks FAIL, 5 are PARTIAL.

The failures are **not random** — they follow 4 systemic patterns:
1. **Call commented out** (4 tasks): Hook registered but `await` line commented with `// TEMPORARILY DISABLED FOR DEBUGGING`
2. **Code island** (17 tasks): Module + tests exist but `src/index.ts` never imports or calls them
3. **Default disabled** (2 tasks): Code works but default config has `enabled: false`
4. **Not implemented** (9 tasks): Zero or near-zero implementation code exists

## Proposed Solution

Fix all 37 broken tasks in 5 waves ordered by risk and effort:
- Wave 0: Uncomment 4 disabled hooks
- Wave 1: Wire 17 code islands into runtime
- Wave 2: Fix 2 default-disabled configs
- Wave 3: Strengthen 5 PARTIAL features
- Wave 4: Implement 9 missing features from scratch

## Success Criteria

- [ ] `bun run typecheck` — 0 errors
- [ ] `bun test` — all pass
- [ ] `bun run build` — success
- [ ] Re-run rt-verify methodology — ≥90% PASS (42+ of 46)
- [ ] Existing 9 PASS tasks remain unbroken

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Uncommented hooks cause runtime errors | Medium | High | Enable one at a time, test individually |
| Code island wiring introduces import cycles | Low | Medium | `bun run typecheck` after each wire |
| New implementations diverge from spec | Medium | Medium | Reference original acceptance criteria |
| Breaking existing 9 PASS features | Low | High | Full `bun test` after each wave |

## Alternatives Considered

1. **Rewrite from scratch**: Too expensive, existing code+tests are mostly correct
2. **Only fix high-priority**: Leaves codebase in inconsistent state
3. **Accept as-is**: Defeats purpose of 50-enhancements project
