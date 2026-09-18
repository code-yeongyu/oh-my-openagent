# Swift — LSP setup

- **Builtin server:** `sourcekit-lsp` — `sourcekit-lsp`
- **Extensions:** `.swift .objc .objcpp`
- **Install hint:** `Included with Xcode or the Swift toolchain`

## Install

`sourcekit-lsp` ships with the Swift toolchain — no separate install.

- **macOS:** `xcode-select --install` (or install full Xcode). It resolves to the active toolchain selected by `xcode-select`.
- **Linux:** Install a swift.org toolchain (`sourcekit-lsp` ships inside it); add the toolchain's `usr/bin` to PATH.
- **Windows:** Install the swift.org Windows toolchain; `sourcekit-lsp` is bundled.

Confirm it resolves:

```bash
command -v sourcekit-lsp
```

## Configure

Builtin — usually NO config needed (auto-resolved by extension). Configure only to set priority, init options, override extensions, or disable. Same JSON shape in `.codex/lsp-client.json` (Codex) AND `.opencode/lsp.json` (OpenCode/omo):

```json
{ "lsp": { "sourcekit-lsp": { "priority": 100 } } }
```

For builtin ids in a PROJECT config, `command` is supplied automatically — only set `priority`/`initialization`/`extensions`/`disabled`/`env`. A fully custom (non-builtin) server with its own `command` must go in the USER config (`~/.codex/lsp-client.json`).

### Initialization options (only if commonly needed)

None commonly required. For best results the project needs a **SwiftPM `Package.swift`** or a `compile_commands.json` compilation database so the server can resolve modules. Pure-Xcode-project files without these resolve poorly.

## Alternatives

- **No mainstream alternative.** `sourcekit-lsp` is the official Apple/swift.org server and the only practical choice.

## Troubleshooting

- **PATH:** `sourcekit-lsp` on PATH; reopen shell after install (or after `xcode-select -s`).
- **Wrong toolchain (macOS):** point `xcode-select` at the right Xcode/toolchain; mismatches cause stale or missing results.
- **No `Package.swift` / compile db:** add a SwiftPM manifest or generate `compile_commands.json` for accurate indexing.
- **Objective-C (`.objc`/`.objcpp`):** needs a compilation database to resolve headers and frameworks.
- **First build slow:** the server builds the module graph on first open; wait for it.

## Verify

```bash
bun ../../scripts/verify-lsp.ts path/to/File.swift
```
