export const MEMORY_TOOL_NAME = "memory"

export const MEMORY_TOOL_DESCRIPTION = [
  "A convenience tool for memories stored in the omo memory repo that automatically commits changes.",
  "",
  "Supported operations: create, str_replace, insert, delete, rename, update_description, and apply_patch.",
  "apply_patch accepts Codex-style multi-file or multi-hunk patches through the input field.",
  "",
  "Memory files are markdown documents with YAML frontmatter. Paths must remain inside the memory repo.",
  "read_only blocks cannot be modified. Commits are authored with the bound omo memory identity; the harness will sync after the turn.",
].join("\n")
