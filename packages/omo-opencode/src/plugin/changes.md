## 2026-10-22 - Preserve global skill source authority (#10693)

Skill context consults disk configuration for source authority while preserving
runtime host paths as the discovery list. Global user-selected paths keep user
MCP policy; project-only paths do not gain it.

## 2026-10-22 - Distinguish skill load errors from security blocks (#10693)

Skill diagnostics retain their original path and I/O reason in a load-error toast.
Only containment violations use the Skill security toast.
