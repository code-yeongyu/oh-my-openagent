# Zig — LSP setup

- **Builtin server:** `zls` — `zls`
- **Extensions:** `.zig .zon`
- **Install hint:** `https://github.com/zigtools/zls`

## Install

ZLS (the Zig Language Server) must be built against the **same Zig version** you use.
See `https://github.com/zigtools/zls`.

- **macOS:** `brew install zls`
- **Linux:** download a prebuilt release matching your Zig version, or `zig build -Doptimize=ReleaseSafe` from the zls source
- **Windows:** download the matching release from the zls GitHub releases, or build from source

Confirm it resolves:

```bash
command -v zls
```

## Configure

Builtin — usually NO config needed (auto-resolved by extension). Configure only to set priority, init options, override extensions, or disable. Same JSON shape in `.codex/lsp-client.json` (Codex) AND `.opencode/lsp.json` (OpenCode/omo):

```json
{ "lsp": { "zls": { "priority": 100 } } }
```

For builtin ids in a PROJECT config, `command` is supplied automatically — only set `priority`/`initialization`/`extensions`/`disabled`/`env`. A fully custom (non-builtin) server with its own `command` must go in the USER config (`~/.codex/lsp-client.json`).

### Initialization options (only if commonly needed)

None commonly required.

## Alternatives

None.

## Troubleshooting
- **VERSION MATCH (critical):** zls version MUST match your zig version — build/install zls against the exact same Zig. A mismatch causes crashes, parse errors, or silent failures. After upgrading Zig, upgrade/rebuild zls too.
- **PATH:** `zls` must be on PATH; reopen the shell after install.
- **zig not found:** zls invokes `zig` for builds — make sure `zig` itself is also on PATH.

## Verify

```bash
bun ../../scripts/verify-lsp.ts path/to/file.zig
```
