# Elixir — LSP setup

- **Builtin server:** `elixir-ls` — `elixir-ls`
- **Extensions:** `.ex .exs`
- **Install hint:** `https://github.com/elixir-lsp/elixir-ls`

## Install

ElixirLS needs Erlang/OTP and Elixir installed first. Build the release from
`https://github.com/elixir-lsp/elixir-ls` and put the `elixir-ls` launcher script on PATH.

- **macOS:** `brew install elixir-ls` (Homebrew provides the launcher), or build the release manually
- **Linux:** clone elixir-ls, run `mix deps.get && mix compile && mix elixir_ls.release2 -o release`, then add `release/` to PATH
- **Windows:** build the release and add the `release` dir (use the `.bat` launcher) to PATH

Confirm it resolves:

```bash
command -v elixir-ls
```

## Configure

Builtin — usually NO config needed (auto-resolved by extension). Configure only to set priority, init options, override extensions, or disable. Same JSON shape in every harness's project config (per-harness paths: the Configure step in `SKILL.md`):

```json
{ "lsp": { "elixir-ls": { "priority": 100 } } }
```

For builtin ids in a PROJECT config, `command` is supplied automatically — only set `priority`/`initialization`/`extensions`/`disabled` (a project entry drops `env`). `env`, and a fully custom (non-builtin) server with its own `command`, must go in your harness's USER config (see the Configure step in `SKILL.md`).

### Initialization options (only if commonly needed)

None commonly required.

## Alternatives

- **lexical** (not builtin): `lexical` — fast, modern alternative LSP.
- **next-ls** (not builtin): `nextls --stdio` — from the elixir-tools project.

## Troubleshooting
- **PATH:** `elixir-ls` must be on PATH; reopen the shell after install.
- **asdf users:** the launcher is a shim — after `asdf install`, run `asdf reshim elixir` so the `elixir-ls` shim resolves, and ensure the Erlang/Elixir versions match the build.
- **First start is slow:** ElixirLS compiles your deps on first run; initial diagnostics can take a while on large projects.
- **OTP mismatch:** build elixir-ls with the same Erlang/Elixir versions you use for the project to avoid bytecode errors.

## Verify

```bash
bun ../../scripts/verify-lsp.ts path/to/file.ex
```
