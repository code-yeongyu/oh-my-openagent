# LIF-64: Fix Critical Hook Issues - Task Breakdown

**Linear Issue**: [LIF-64](https://linear.app/lifelogger/issue/LIF-64)
**Created**: 2025-12-18
**Last Updated**: 2025-12-18

## Implementation Order

| Order | Phase | Task ID | Priority | Est. Time | Status |
|-------|-------|---------|----------|-----------|--------|
| 1 | 1.1 | T001 | CRITICAL | 30m | In Progress |
| 2 | 1.2 | T002 | CRITICAL | 30m | In Progress |
| 3 | 1.3 | T003 | CRITICAL | 20m | In Progress |
| 4 | 6.1 | T004 | HIGH | 20m | Not Started |
| 5 | 2.1-2.3 | T005 | HIGH | 1.5h | Not Started |
| 6 | 3.1-3.3 | T006 | HIGH | 1h | Not Started |
| 7 | 5.1 | T007 | MEDIUM | 1h | In Progress |
| 8 | 4.1 | T008 | MEDIUM | 1h | Not Started |
| 9 | 4.2 | T009 | LOW | 1h | Not Started |

## Tasks

### Phase 1: Security Fixes (CRITICAL)

| ID | Task | Status | Estimate | Assignee |
|----|------|--------|----------|----------|
| T001 | Fix git-safety-validator: Replace `output.args.command = ...` with `throw new Error(...)` at line 49 | In Progress | 30m | backend-typescript (bg_7c6f764d) |
| T002 | Fix security-scanner: Replace content modification with `throw new Error(...)` at lines 75-80 | In Progress | 30m | backend-typescript (bg_f6f5d12e) |
| T003 | Fix conflict-detector: Replace `output.args.content = ...` with `throw new Error(...)` at line 64 | In Progress | 20m | backend-typescript (bg_bc36a6ab) |

### Phase 6: Lock Leak Fix (HIGH - Do after Phase 1)

| ID | Task | Status | Estimate | Assignee |
|----|------|--------|----------|----------|
| T004 | Reorder hooks in src/index.ts: validation hooks BEFORE conflict-detector lock acquisition | Not Started | 20m | - |

### Phase 2: Agent Detection Fix (HIGH)

| ID | Task | Status | Estimate | Assignee |
|----|------|--------|----------|----------|
| T005 | Create session-agent registry in src/features/claude-code-session-state/agent-registry.ts | Not Started | 1.5h | - |
| T005a | Update call-omo-agent to register agent names on delegation | Not Started | - | - |
| T005b | Update conflict-detector to use registry instead of _agentName | Not Started | - | - |

### Phase 3: HookHealthManager Integration (HIGH)

| ID | Task | Status | Estimate | Assignee |
|----|------|--------|----------|----------|
| T006 | Define CRITICAL_HOOKS allowlist (governance-path-validator, security-scanner, git-safety-validator) | Not Started | 1h | - |
| T006a | Wrap non-critical hooks with safeHookCall in src/index.ts | Not Started | - | - |
| T006b | Add metrics logging on session end | Not Started | - | - |

### Phase 5: Git Parser Fix (MEDIUM)

| ID | Task | Status | Estimate | Assignee |
|----|------|--------|----------|----------|
| T007 | Add parseShellArgs helper function to handle quoted arguments | In Progress | 1h | backend-typescript (bg_398cd2f3) |

### Phase 4: Orchestration Integration (MEDIUM/LOW)

| ID | Task | Status | Estimate | Assignee |
|----|------|--------|----------|----------|
| T008 | Integrate MaxTurnsEnforcer in src/index.ts event handler | Not Started | 1h | - |
| T009 | Integrate RetryMiddleware for MCP connections (optional) | Not Started | 1h | - |

### Verification

| ID | Task | Status | Estimate | Assignee |
|----|------|--------|----------|----------|
| T010 | Run typecheck and build, verify all changes compile | Not Started | 15m | - |
| T011 | Manual testing: verify throw-based blocking works | Not Started | 30m | - |

## Notes

### Key Decision (from DeepWiki)
> "The proper way to block a tool from executing in a plugin hook is to throw an error within the tool.execute.before hook."

### Files to Modify
- `src/hooks/git-safety-validator/index.ts` - T001
- `src/hooks/security-scanner/index.ts` - T002
- `src/hooks/conflict-detector/index.ts` - T003
- `src/hooks/git-safety-validator/validator.ts` - T007
- `src/index.ts` - T004, T006, T008
- `src/features/claude-code-session-state/agent-registry.ts` - T005 (new file)
- `src/tools/call-omo-agent/tools.ts` - T005a

### Dependencies
- T004 depends on T001, T002, T003 (validation hooks must throw before reordering)
- T005b depends on T005, T005a (registry must exist before using)
- T006a depends on T006 (allowlist must be defined)
- T010 depends on all implementation tasks
