# packages/coding-agent/src/utils

Cross-cutting utilities used by `core/`, `cli/`, `modes/`, and `extensions/`. No domain logic — only deterministic helpers. 29 source files, all leaf-level.

## FILES (grouped by concern)

```
utils/
├── git.ts                       # git CLI wrapper (status, diff, stash, commit, current branch)
├── shell.ts                     # Spawn + capture; safe arg quoting
├── child-process.ts             # Lower-level spawn helpers used by shell.ts
├── paths.ts                     # Resolve repo root, home expansion, glob helpers
├── fs-watch.ts                  # File watcher (used by reload + extension HMR)
├── open-browser.ts              # Open URL/file via platform handler; never goes through a shell
├── mime.ts                      # File extension → MIME type
├── clipboard.ts                 # Cross-platform clipboard read/write entry
├── clipboard-image.ts           # Clipboard image decode
├── clipboard-native.ts          # OS-specific clipboard backend
├── image-resize.ts              # Resize entry — runs image-resize-core in a worker, in-process fallback
├── image-resize-core.ts         # Photon resize implementation shared by main thread + worker
├── image-resize-worker.ts       # worker_threads entry wrapping image-resize-core
├── image-convert.ts             # Image format conversion
├── exif-orientation.ts          # EXIF rotation correction
├── photon.ts                    # @cf/photon WASM bootstrap
├── ansi.ts                      # ANSI escape regex + stripAnsi (vendored from ansi-regex/strip-ansi)
├── html.ts                      # HTML entity decoding
├── json.ts                      # stripJsonComments — strip // comments + trailing commas
├── syntax-highlight.ts          # highlight.js wrapper → themed terminal formatting
├── highlight-js-lib-index.d.ts  # Type declarations for highlight.js/lib/index.js
├── frontmatter.ts               # YAML frontmatter parser (skills, prompt templates)
├── sleep.ts                     # Promise-returning timer with abort
├── deprecation.ts               # One-shot deprecation warnings (deduped by message)
├── tools-manager.ts             # Probe + cache fd/rg presence for startup-tools
├── changelog.ts                 # Parse + render the senpi CHANGELOG.md
├── version-check.ts             # Senpi latest-version fetch (queries senpi npm, NOT pi.dev)
├── pi-user-agent.ts             # UA string for update checks; uses runtime app name
├── windows-self-update.ts       # Quarantines locked native files so Windows self-update can replace them
└── changes.md                   # Fork tracker (version-check + pi-user-agent rebrand)
```

## WHERE TO LOOK

| Task | File |
|------|------|
| Run a shell command from senpi internals | `shell.ts` — uses `child-process.ts` under the hood |
| Resolve a path safely | `paths.ts` |
| Detect fd/rg at startup | `tools-manager.ts` (cached, non-blocking; see `modes/interactive/startup-tools.ts`) |
| Parse a skill / prompt template | `frontmatter.ts` |
| Image-related work (paste, attachment) | `image-resize.ts`, `image-convert.ts`, `exif-orientation.ts` |
| Update-check or self-update | `version-check.ts` (senpi npm registry) — fork-modified |

## CONVENTIONS

- **Cross-platform first**: clipboard, paths, and shell paths all assume macOS/Linux/Windows. Test on at least two when changing.
- **No core/ or extensions/ imports**: utils sits at the bottom of the dependency graph. Reverse imports = circular.
- **Streaming-safe**: anything used during agent streaming (e.g. `tools-manager.ts`) must be non-blocking.
- **Senpi branding** in user-facing strings: version-check + UA use the runtime app name (resolved from `config.ts`), not hardcoded `"pi"`.

## ANTI-PATTERNS

- Importing from `core/` — utils is a leaf. Add data via parameter, not via `import`.
- Hard-coding `pi-mono` / `pi.dev` URLs — version-check queries the senpi npm package; pi-user-agent uses the runtime app name. See `changes.md` 2026-05-02.
- Adding new image dependencies — use `photon.ts` (WASM) over heavyweight native libs.
- Bypassing `tools-manager.ts` for fd/rg detection — duplicates the startup-tools probe.

## NOTES

- `photon.ts` is a WASM module; first call has a small init cost (cached). Don't move it into the streaming hot path.
- `tools-manager.ts` powers the fork's non-blocking startup probe (vs. upstream's awaited fd/rg download). See `modes/interactive/changes.md`.
- `frontmatter.ts` is shared by skill discovery (in `core/resource-loader.ts`) and prompt-template loading; keep its YAML subset deterministic.
