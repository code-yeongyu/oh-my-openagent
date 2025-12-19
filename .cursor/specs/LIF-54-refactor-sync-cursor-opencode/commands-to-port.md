# Commands to Port - Phase 4

**Created**: 2025-12-16
**Completed**: 2025-12-16
**Task**: T026-T031 - Port All Low-Priority Commands
**Linear Issue**: LIF-54
**Status**: ✅ COMPLETE

## Summary

This document tracks the 17 commands ported from Cursor to OpenCode, plus 2 commands intentionally skipped. **All 17 commands have been successfully ported.**

## Commands Already in OpenCode (16 total)

These commands already exist in `.opencode/command/` and do NOT need porting:

| Command | Status | Notes |
|---------|--------|-------|
| analyze.md | ✅ Synced | Phase 1 verified |
| checklist.md | ✅ Synced | Phase 1 verified |
| clarify.md | ✅ Synced | Phase 1 verified |
| code-review.md | ✅ Synced | Phase 1 verified |
| update-context.md | ✅ Synced | Phase 1 verified |
| implement.md | ✅ Synced | Phase 2 ported |
| plan.md | ✅ Synced | Phase 2 ported |
| specify.md | ✅ Synced | Phase 2 ported |
| tasks.md | ✅ Synced | Phase 2 ported |
| superwhisper-mode.md | ✅ Synced | Phase 2 ported |
| sync-linear.md | ✅ Synced | Phase 2 ported |
| create-pr.md | ✅ Synced | Phase 2 ported |
| debug-issue.md | ✅ Synced | Phase 2 ported |
| proceed.md | ✅ Synced | Phase 2 ported |
| init-project.md | ✅ OpenCode-only | Preserved |
| orchestrator.md | ✅ OpenCode-only | Preserved |

## Commands to Port (17 total)

### Priority 1 - Specialized Workflows (4 commands) ✅ COMPLETE

High-value commands for specialized development workflows.

| # | Command | Cursor Path | OpenCode Path | Status |
|---|---------|-------------|---------------|--------|
| 1 | refactor-code.md | `.cursor/commands/refactor-code.md` | `.opencode/command/refactor-code.md` | ✅ Ported |
| 2 | security-audit.md | `.cursor/commands/security-audit.md` | `.opencode/command/security-audit.md` | ✅ Ported |
| 3 | write-unit-tests.md | `.cursor/commands/write-unit-tests.md` | `.opencode/command/write-unit-tests.md` | ✅ Ported |
| 4 | add-documentation.md | `.cursor/commands/add-documentation.md` | `.opencode/command/add-documentation.md` | ✅ Ported |

### Priority 2 - Development Helpers (9 commands) ✅ COMPLETE

Common development workflow commands.

| # | Command | Cursor Path | OpenCode Path | Status |
|---|---------|-------------|---------------|--------|
| 5 | add-error-handling.md | `.cursor/commands/add-error-handling.md` | `.opencode/command/add-error-handling.md` | ✅ Ported |
| 6 | address-github-pr-comments.md | `.cursor/commands/address-github-pr-comments.md` | `.opencode/command/address-github-pr-comments.md` | ✅ Ported |
| 7 | create-command.md | `.cursor/commands/create-command.md` | `.opencode/command/create-command.md` | ✅ Ported |
| 8 | create-prs-from-branches.md | `.cursor/commands/create-prs-from-branches.md` | `.opencode/command/create-prs-from-branches.md` | ✅ Ported |
| 9 | discuss.md | `.cursor/commands/discuss.md` | `.opencode/command/discuss.md` | ✅ Ported |
| 10 | impl-plan.md | `.cursor/commands/impl-plan.md` | `.opencode/command/impl-plan.md` | ✅ Ported |
| 11 | lint-fix.md | `.cursor/commands/lint-fix.md` | `.opencode/command/lint-fix.md` | ✅ Ported |
| 12 | optimize-performance.md | `.cursor/commands/optimize-performance.md` | `.opencode/command/optimize-performance.md` | ✅ Ported |
| 13 | run-all-tests-and-fix.md | `.cursor/commands/run-all-tests-and-fix.md` | `.opencode/command/run-all-tests-and-fix.md` | ✅ Ported |

### Priority 3 - Utility Commands (4 commands) ✅ COMPLETE

Less frequently used utility commands.

| # | Command | Cursor Path | OpenCode Path | Status |
|---|---------|-------------|---------------|--------|
| 14 | try-hard.md | `.cursor/commands/try-hard.md` | `.opencode/command/try-hard.md` | ✅ Ported |
| 15 | 1-deep-review-project.md | `.cursor/commands/1-deep-review-project.md` | `.opencode/command/deep-review-project.md` | ✅ Ported (renamed) |
| 16 | speckit.constitution.md | `.cursor/commands/speckit.constitution.md` | `.opencode/command/speckit-constitution.md` | ✅ Ported (deprecated) |
| 17 | NR-review-pr.md | `.cursor/commands/NR-review-pr.md` | `.opencode/command/review-pr.md` | ✅ Ported (renamed) |

## Commands to SKIP (2 total)

| Command | Reason | Alternative |
|---------|--------|-------------|
| conductor.md | Maps to orchestrator.md which already exists in OpenCode | Use `/orchestrator` in OpenCode |
| conductor.help.md | Low value; would need orchestrator.help.md equivalent | Not needed - orchestrator.md is self-documenting |

### Skip Rationale

**conductor.md**: This is the Cursor equivalent of OpenCode's orchestrator. The orchestrator agent already exists at `.opencode/agent/orchestrator.md` and serves the same purpose (entry point for workflows). Porting conductor.md would create redundancy.

**conductor.help.md**: This provides help documentation for the conductor command. Since we're not porting conductor.md, this help file is not needed. The orchestrator agent is self-documenting with its comprehensive instructions.

## Translation Rules Applied

1. **YAML Frontmatter**: Add `description:` field to all commands
2. **Agent Paths**: Use `.opencode/agent/{agent}.md` (FLAT structure)
3. **Agent Names**: Use flat names (e.g., `historian` NOT `governance/historian`)
4. **Shared Resources**: Keep `.cursor/specs/`, `.cursor/memory/` paths unchanged
5. **Governance**: Include Historian call at end where appropriate
6. **Filename Convention**: Use kebab-case, remove special prefixes (e.g., `1-`, `NR-`)

## Porting Progress

| Priority | Total | Ported | Remaining |
|----------|-------|--------|-----------|
| Priority 1 | 4 | 4 | 0 |
| Priority 2 | 9 | 9 | 0 |
| Priority 3 | 4 | 4 | 0 |
| **Total** | **17** | **17** | **0** |

## Completion Summary

### Commands Ported (17 total)

All 17 commands have been successfully ported to `.opencode/command/`:

1. `refactor-code.md` - Code refactoring with quality improvements
2. `security-audit.md` - Comprehensive security review
3. `write-unit-tests.md` - Unit test creation with coverage
4. `add-documentation.md` - Documentation creation
5. `add-error-handling.md` - Error handling implementation
6. `address-github-pr-comments.md` - PR feedback processing
7. `create-command.md` - Custom command generation
8. `create-prs-from-branches.md` - Batch PR creation with Linear integration
9. `discuss.md` - Collaborative problem exploration
10. `impl-plan.md` - Implementation planning
11. `lint-fix.md` - Linting and auto-fix
12. `optimize-performance.md` - Performance optimization
13. `run-all-tests-and-fix.md` - Test execution and fix
14. `try-hard.md` - Extensive planning with first-principles
15. `deep-review-project.md` - Branch review (renamed from `1-deep-review-project.md`)
16. `speckit-constitution.md` - Deprecated command (redirects to `/update-context`)
17. `review-pr.md` - Comprehensive PR review (renamed from `NR-review-pr.md`)

### Commands Skipped (2 total)

- `conductor.md` - Maps to existing `orchestrator.md`
- `conductor.help.md` - Low value, orchestrator is self-documenting

### Translation Applied

All ported commands follow OpenCode conventions:
- ✅ YAML frontmatter with `description:` field
- ✅ Flat agent paths (`.opencode/agent/{agent}.md`)
- ✅ Historian governance calls where appropriate
- ✅ Kebab-case filenames (special prefixes removed)
- ✅ Shared resource paths unchanged (`.cursor/specs/`, `.cursor/memory/`)

### Issues Encountered

None - all commands ported successfully.

## Notes

- All commands use OpenCode YAML frontmatter format
- Agent references use flat structure (`.opencode/agent/{agent}.md`)
- Historian governance call added where appropriate
- Complex commands (create-command, create-prs-from-branches, review-pr) adapted for OpenCode patterns
