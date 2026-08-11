# C / C++ — LSP setup

- **Builtin server:** `clangd` — `clangd --background-index --clang-tidy`
- **Extensions:** `.c .cpp .cc .cxx .c++ .h .hpp .hh .hxx .h++`
- **Install hint:** `https://clangd.llvm.org/installation`

## Install

- **macOS:** `brew install llvm` (clangd ships in the LLVM keg; add its `bin` to PATH)
- **Linux:** `apt install clangd` (Debian/Ubuntu); use your distro package elsewhere
- **Windows:** install LLVM from `https://releases.llvm.org` or `winget install LLVM.LLVM`

See `https://clangd.llvm.org/installation` for other platforms.

Confirm it resolves:

```bash
command -v clangd
```

## Configure

Builtin — usually NO config needed (auto-resolved by extension). Configure only to set priority, init options, override extensions, or disable. Same JSON shape in `.codex/lsp-client.json` (Codex) AND `.opencode/lsp.json` (OpenCode/omo):

```json
{ "lsp": { "clangd": { "priority": 100 } } }
```

For builtin ids in a PROJECT config, `command` is supplied automatically — only set `priority`/`initialization`/`extensions`/`disabled`/`env`. A fully custom (non-builtin) server with its own `command` must go in the USER config (`~/.codex/lsp-client.json`).

### Initialization options (only if commonly needed)

None commonly required. clangd reads flags from a project `.clangd` file rather
than initializationOptions. The builtin command already passes
`--background-index --clang-tidy`.

## Compile commands

clangd needs a `compile_commands.json` at the project root (or in `build/`) for
accurate diagnostics and cross-file navigation. Generate it with:

- **CMake:** `cmake -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON` (symlink/copy `build/compile_commands.json` to the root)
- **Make / other:** `bear -- make`

Without it, clangd falls back to heuristic flags and reports spurious errors.

## Alternatives

None builtin. `ccls` exists as a third-party server but is not builtin — it would
need a custom `command` in the USER config.

## Troubleshooting
- **PATH:** `clangd` must be on PATH; reopen shell after install. Homebrew LLVM is keg-only — add `$(brew --prefix llvm)/bin` to PATH.
- **Spurious "file not found" / unknown flags:** missing or stale `compile_commands.json` — regenerate it after changing the build.
- **Header-only diagnostics wrong:** ensure the header's translation unit appears in the compile database, or add a `.clangd` `CompileFlags` block.

## Verify

```bash
bun ../../scripts/verify-lsp.ts path/to/file.cpp
```
