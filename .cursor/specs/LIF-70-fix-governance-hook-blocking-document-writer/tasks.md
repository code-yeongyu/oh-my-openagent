# Fix Governance Hook Blocking Document-Writer - Task Breakdown

**Linear Issue**: [LIF-70](https://linear.app/lifelogger/issue/LIF-70)
**Created**: 2025-12-21

## Tasks

| ID | Task | Status | Estimate | Assignee |
|----|------|--------|----------|----------|
| T001 | Add setSessionAgent import to manager.ts | Not Started | 5m | - |
| T002 | Call setSessionAgent after session creation | Not Started | 5m | - |
| T003 | Run typecheck to verify build | Not Started | 2m | - |
| T004 | Update status.md with completion | Not Started | 2m | - |

## Notes

- Single file change: `src/features/background-agent/manager.ts`
- Surgical fix: 2 lines of code (1 import, 1 function call)
- Total estimate: ~15 minutes
