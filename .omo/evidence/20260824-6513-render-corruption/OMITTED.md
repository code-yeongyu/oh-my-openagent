# WHAT WAS OMITTED

- No live OpenCode TUI/server QA was driven: the defect and fix are fully
  confined to the `omo run` CLI SSE render path (pure function-level behavior
  over event payloads), covered hermetically by bun tests. No opencode process
  was spawned, so no XDG isolation proof or session-count check applies.
- The `eval` (Python kernel) and `read` tool implementations live in the
  external OpenCode app, not this repository; their on-disk/kernel output was
  never in question (issue confirms disk content correct). Only the plugin-side
  render path was fixed.
- Environment notes: `bun install` prepare step fails on the pre-existing
  shared-skills submodule fetch failure (`git clone` of
  nextlevelbuilder/ui-ux-pro-max-skill reset by peer; open-design revision
  missing). Harmless for tests/typecheck; the dirty submodule worktrees under
  packages/shared-skills/upstreams/* are NOT staged.
- LSP daemon diagnostics unavailable in this environment (daemon socket never
  became reachable); tsgo typecheck is the authoritative static gate and is
  clean.
- No secrets, tokens, or env dumps are present in any evidence artifact.
