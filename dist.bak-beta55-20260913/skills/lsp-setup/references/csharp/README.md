# C# — LSP setup

- **Builtin server:** `csharp` — `csharp-ls`
- **Extensions:** `.cs`
- **Install hint:** `dotnet tool install -g csharp-ls`

## Install

Requires the **.NET SDK**. Install the tool globally:

- **macOS:** `dotnet tool install -g csharp-ls`
- **Linux:** `dotnet tool install -g csharp-ls`
- **Windows:** `dotnet tool install -g csharp-ls`

Global .NET tools land in `~/.dotnet/tools` — ensure that directory is on PATH (Windows: `%USERPROFILE%\.dotnet\tools`).

Confirm it resolves:

```bash
command -v csharp-ls
```

## Configure

Builtin — usually NO config needed (auto-resolved by extension). Configure only to set priority, init options, override extensions, or disable. Same JSON shape in `.codex/lsp-client.json` (Codex) AND `.opencode/lsp.json` (OpenCode/omo):

```json
{ "lsp": { "csharp": { "priority": 100 } } }
```

For builtin ids in a PROJECT config, `command` is supplied automatically — only set `priority`/`initialization`/`extensions`/`disabled`/`env`. A fully custom (non-builtin) server with its own `command` must go in the USER config (`~/.codex/lsp-client.json`).

### Initialization options (only if commonly needed)

None commonly required. `csharp-ls` picks up the nearest `.sln` or `.csproj`; keep the solution restorable (`dotnet restore`).

## Razor / Blazor

Razor and Blazor files use a separate builtin server:

- **Builtin server:** `razor` — `roslyn-language-server --stdio`
- **Extensions:** `.razor .cshtml`
- **Install hint:** `dotnet tool install -g roslyn-language-server --prerelease` (requires **v5.8.0+**; see [dotnet/razor](https://github.com/dotnet/razor))

```bash
dotnet tool install -g roslyn-language-server --prerelease
command -v roslyn-language-server
```

Enable it in a project/user config:

```json
{ "lsp": { "razor": { } } }
```

## Alternatives

- **OmniSharp** — legacy C# language server (not builtin). Still works but is being superseded by the Roslyn-based servers; prefer `csharp-ls` / `roslyn-language-server`.

## Troubleshooting

- **PATH:** `csharp-ls` / `roslyn-language-server` on PATH (`~/.dotnet/tools`); reopen shell after install.
- **No .NET SDK:** install the SDK (not just the runtime) before installing the tool.
- **No symbols:** run `dotnet restore`; an unrestored solution yields empty results.
- **Razor needs v5.8.0+:** older `roslyn-language-server` builds lack the `--stdio` Razor support — install with `--prerelease`.

## Verify

```bash
bun ../../scripts/verify-lsp.ts path/to/File.cs
```
