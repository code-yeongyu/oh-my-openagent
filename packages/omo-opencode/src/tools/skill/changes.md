## 2026-10-22 - Cover global OpenCode MCP authority (#10693)

Regression tests exercise disk-only and merged runtime configuration through skill
context and the MCP authority resolver, preserving user policy for global paths
outside conventional user directories and project policy for project paths.

## 2026-10-22 - Surface skill I/O failures without cached fallback (#10693)

Project skill read failures, including missing native rows, remain unloaded and
surface the original error at invocation. Native rows that fail do not hide later
valid rows. Real escapes retain their containment diagnostics.
