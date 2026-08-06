# Lua — LSP setup

- **Builtin server:** `lua-ls` — `lua-language-server`
- **Extensions:** `.lua`
- **Install hint:** `https://github.com/LuaLS/lua-language-server`

## Install

See `https://github.com/LuaLS/lua-language-server`.

- **macOS:** `brew install lua-language-server`
- **Linux:** download a release from GitHub, or `pacman -S lua-language-server` (Arch) / AUR
- **Windows:** download a release from the GitHub releases page and add its `bin` to PATH

Confirm it resolves:

```bash
command -v lua-language-server
```

## Configure

Builtin — usually NO config needed (auto-resolved by extension). Configure only to set priority, init options, override extensions, or disable. Same JSON shape in `.codex/lsp-client.json` (Codex) AND `.opencode/lsp.json` (OpenCode/omo):

```json
{ "lsp": { "lua-ls": { "priority": 100 } } }
```

For builtin ids in a PROJECT config, `command` is supplied automatically — only set `priority`/`initialization`/`extensions`/`disabled`/`env`. A fully custom (non-builtin) server with its own `command` must go in the USER config (`~/.codex/lsp-client.json`).

### Initialization options (only if commonly needed)

For Neovim config development, point the server at the Neovim runtime and set the Lua runtime version so `vim` globals and stdlib resolve:

```json
{
  "lsp": {
    "lua-ls": {
      "initialization": {
        "Lua": {
          "runtime": { "version": "LuaJIT" },
          "workspace": {
            "library": ["/usr/share/nvim/runtime/lua"]
          },
          "diagnostics": { "globals": ["vim"] }
        }
      }
    }
  }
}
```

## Alternatives

None.

## Troubleshooting
- **PATH:** `lua-language-server` must be on PATH; reopen the shell after install.
- **Undefined `vim` global:** add `vim` to `Lua.diagnostics.globals` and set `Lua.workspace.library` (see above) for Neovim work.
- **Wrong runtime version:** set `Lua.runtime.version` (`LuaJIT`, `Lua 5.4`, etc.) to match your interpreter, or stdlib functions report as undefined.

## Verify

```bash
bun ../../scripts/verify-lsp.ts path/to/file.lua
```
