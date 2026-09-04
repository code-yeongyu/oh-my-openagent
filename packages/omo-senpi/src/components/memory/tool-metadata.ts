// Shared memory tool identity + description metadata. The senpi ToolDefinition layer (tools.ts) and the
// standalone MCP server (src/mcp/memory-server.ts) both consume this module, so it must stay free of
// TypeBox and harness imports: the MCP bundle runs under plain Node with no senpi runtime present.

export const MEMORY_TOOL_NAME = "memory"
export const MEMORY_APPLY_PATCH_TOOL_NAME = "memory_apply_patch"

// MCP surface identity. senpi names catalog tools `mcp_<server>_<tool>` with non-alphanumerics
// (except dash/underscore) sanitized, so the omo-memory server exposes these exact tool names in
// tool_call/tool_result events (senpi builtin mcp expose/naming.ts).
export const MEMORY_MCP_SERVER_NAME = "omo-memory"
export const MEMORY_MCP_TOOL_NAME = `mcp_${MEMORY_MCP_SERVER_NAME}_${MEMORY_TOOL_NAME}`
export const MEMORY_MCP_APPLY_PATCH_TOOL_NAME = `mcp_${MEMORY_MCP_SERVER_NAME}_${MEMORY_APPLY_PATCH_TOOL_NAME}`

export const MEMORY_TOOL_DESCRIPTION = [
  "A convenience tool for memories stored in the omo memory repo that automatically commits changes. The harness syncs clean committed memory changes after the turn.",
  "",
  "Memory files are markdown documents with YAML frontmatter. Frontmatter carries a `description` (required on create; it is what the memory index shows) and may set `read_only: \"true\"` to block modification. Edits preserve existing frontmatter.",
  "",
  "Supported operations on memory files:",
  "- `str_replace`",
  "- `insert`",
  "- `delete` (files, or directories recursively)",
  "- `rename` (path rename only)",
  "- `update_description`",
  "- `create`",
  "For larger reorganizations, use memory_apply_patch instead.",
  "",
  "Path formats accepted:",
  "- relative memory file paths (e.g. `system/contacts.md`, `reference/project/team.md`)",
  "- absolute paths only when they are inside the memory repo",
  "",
  "Note: absolute paths outside the memory repo are rejected.",
  "",
  "When creating or deleting files, check for `[[path]]` references in other memory files that may need to be added or updated. Keeping references consistent ensures future discoverability.",
  "",
  "On success the tool returns `Memory <command> committed locally (<sha>).`, or `Memory <command> committed (<sha>); harness will sync after the turn.` when a remote is configured. Commits are authored with the bound omo memory identity.",
].join("\n")

export const MEMORY_APPLY_PATCH_DESCRIPTION = [
  "Apply a codex-style patch to memory files in the omo memory repo, then automatically commit the change. The harness syncs clean committed memory changes after the turn.",
  "",
  "This is similar to `apply_patch`, but scoped to the memory repo and with memory-aware guardrails. `input` is patch text in the standard apply_patch format (`*** Begin Patch` ... `*** Add/Update/Delete File` ... `*** End Patch`); `reason` is the git commit message.",
  "",
  "Path rules:",

  "- Relative paths are interpreted inside the memory repo",
  "- Absolute paths are allowed only when under the memory repo",
  "- Paths outside the memory repo are rejected",
  "",
  "Memory rules:",
  "- Operates on markdown memory files (`.md`) with YAML frontmatter",
  "- Updated/deleted files must be valid memory files with frontmatter",
  "- `read_only: \"true\"` files cannot be modified",
  "- If adding a file without frontmatter, frontmatter is created automatically",
  "",
  "Git behavior:",
  "- Stages changed memory paths",
  "- Commits with `reason`, authored by the bound omo memory identity (`<identity>@omo.local`)",
  "- Sync to a configured remote is handled by the harness after the turn",
  "",
  "On success the tool returns `memory_apply_patch committed locally (<sha>).`, or `memory_apply_patch committed (<sha>); harness will sync after the turn.` when a remote is configured.",
  "",
  "Example:",
  "```python",
  "memory_apply_patch(",
  '  reason="Refine coding preferences",',
  '  input="""*** Begin Patch',
  "*** Update File: system/human/prefs/coding.md",
  "@@",
  "-Use broad abstractions",
  "+Prefer small focused helpers",
  '*** End Patch"""',
  ")",
  "```",
].join("\n")
