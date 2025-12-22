# Fix Governance Hook Blocking Document-Writer - Task Breakdown

**Linear Issue**: [LIF-70](https://linear.app/lifelogger/issue/LIF-70)
**Created**: 2025-12-21

## Tasks

| ID | Task | Status | Estimate | Assignee |
|----|------|--------|----------|----------|
| T001 | Add setSessionAgent import to manager.ts | Completed | 5m | document-writer |
| T002 | Call setSessionAgent after session creation | Completed | 5m | document-writer |
| T003 | Run typecheck to verify build | Completed | 2m | document-writer |
| T004 | Update status.md with completion | Completed | 2m | document-writer |

## Notes

- Single file change: `src/features/background-agent/manager.ts`
- Surgical fix: 2 lines of code (1 import, 1 function call)
- Total estimate: ~15 minutes
