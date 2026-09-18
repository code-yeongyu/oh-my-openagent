# Ruby — LSP setup

- **Builtin server:** `ruby-lsp` — `rubocop --lsp`
- **Extensions:** `.rb .rake .gemspec .ru`
- **Install hint:** `gem install ruby-lsp`

> **Note:** the builtin id is `ruby-lsp`, but the executable actually invoked is **`rubocop`** (`rubocop --lsp`). RuboCop must be installed: `gem install rubocop`.

## Install

- **macOS:** `gem install rubocop` (and `gem install ruby-lsp` for the install hint's gem)
- **Linux:** `gem install rubocop`
- **Windows:** `gem install rubocop`

In a Bundler project, prefer adding `rubocop` to the `Gemfile` and running via `bundle exec`.

Confirm it resolves (check `rubocop`, since that is what runs):

```bash
command -v rubocop
```

## Configure

Builtin — usually NO config needed (auto-resolved by extension). Configure only to set priority, init options, override extensions, or disable. Same JSON shape in `.codex/lsp-client.json` (Codex) AND `.opencode/lsp.json` (OpenCode/omo):

```json
{ "lsp": { "ruby-lsp": { "priority": 100 } } }
```

For builtin ids in a PROJECT config, `command` is supplied automatically — only set `priority`/`initialization`/`extensions`/`disabled`/`env`. A fully custom (non-builtin) server with its own `command` must go in the USER config (`~/.codex/lsp-client.json`).

### Initialization options (only if commonly needed)

None commonly required. Behavior is driven by your `.rubocop.yml`; the server surfaces RuboCop diagnostics, formatting, and code actions over LSP.

## Alternatives

- **`ruby-lsp` gem server** (not builtin) — the standalone Shopify Ruby LSP binary (`ruby-lsp` executable), richer navigation than RuboCop alone. Configure as a custom server with `command: ["ruby-lsp"]` in the USER config.
- **`solargraph`** (not builtin) — older completion/type server; install with `gem install solargraph`, custom `command: ["solargraph", "stdio"]`.

## Troubleshooting

- **PATH:** `rubocop` on PATH (that is the invoked binary, not `ruby-lsp`); reopen shell after install.
- **`rubocop` not found:** the builtin fails even if the `ruby-lsp` gem is installed — install RuboCop with `gem install rubocop`.
- **Bundler mismatch:** if the project pins RuboCop in its `Gemfile`, run inside the bundle so versions match.
- **No diagnostics:** check `.rubocop.yml` is valid and not disabling everything.

## Verify

```bash
bun ../../scripts/verify-lsp.ts path/to/file.rb
```
