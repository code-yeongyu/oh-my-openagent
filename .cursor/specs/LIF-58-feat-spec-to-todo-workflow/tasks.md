# LIF-58 - Task Breakdown

**Linear Issue**: [LIF-58](https://linear.app/lifelogger/issue/LIF-58/add-spec-to-todo-workflow-to-omo)
**Created**: 2025-12-18

## Tasks

| ID | Task | Status | Estimate | Notes |
|----|------|--------|----------|-------|
| T001 | Design `<Spec_Workflow>` section structure | Done | 1h | Define detection, parsing, conversion logic |
| T002 | Implement spec folder detection logic in OmO prompt | Done | 1h | Check .cursor/specs/ and context/specs/ |
| T003 | Implement tasks.md → todowrite conversion logic | Done | 1.5h | Parse table format, create todos |
| T004 | Update `<Decision_Matrix>` with spec workflow triggers | Done | 30m | Add Linear issue → spec folder check |
| T005 | Update `<Todo_Management>` to reference spec-based todos | Done | 30m | Cross-reference with spec workflow |
| T006 | Test OmO prompt compiles and agent loads | Done | 30m | Verified: agent loads, prompt=33515 chars |
| T007 | Update Linear issue to Done | Done | 5m | Completion summary added |

## Dependencies

- T002, T003 depend on T001 (design first)
- T004, T005 can run parallel after T003
- T006 depends on T002-T005 completion
- T007 depends on T006 (verification)

## Notes

- This is prompt-only work - no new tools or code required
- `create_spec_folder` tool already exists from LIF-57
- Tasks.md format: Table with ID, Task, Status, Estimate columns
- Total estimated effort: ~4-5 hours
