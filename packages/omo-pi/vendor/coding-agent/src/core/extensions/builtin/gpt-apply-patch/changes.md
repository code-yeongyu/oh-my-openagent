# changes

## Hunk-centered large diff previews (2026-05-12)

### What changed

- `preview-format.ts`: Large apply_patch previews now truncate around the first changed hunk instead of showing only the file head and tail, while still enforcing the configured preview line and character caps.

### Why

- Large file edits could render line-count summaries like `(+2 -0)` while hiding the actual added or removed lines, making the TUI preview misleading.

### Why extension system couldn't handle this

- The behavior belongs to this builtin extension's renderer and the vendored `pi-apply-patch` source that generates the preview text.

### Expected merge conflict zones

- LOW: `preview-format.ts` around `truncatePreview()` when refreshing the vendored apply_patch renderer.
