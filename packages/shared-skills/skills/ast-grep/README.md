# ast-grep-skill

LLM-neutral skill for **AST-aware search and rewrite** across 25 languages. Wraps the [`ast-grep`](https://ast-grep.github.io/) (`sg`) CLI with offline pattern validation, the two-pass write trick, binary auto-resolution, and a per-OS installer.

Same shape as [`web-fetch`](https://github.com/code-yeongyu/web-fetch) and [`web-search`](https://github.com/code-yeongyu/web-search), packaged as a standalone skill that any Bash-capable agent (Claude Code, OpenCode, pi, hermes, openclaw) can load.

## Install

```bash
git clone https://github.com/code-yeongyu/ast-grep-skill ~/.agents/skills/ast-grep
bash ~/.agents/skills/ast-grep/install.sh        # installs the ast-grep binary
```

That is it. The wrapper script is single-file Python 3 stdlib; no `pip install` needed. The installer tries `brew` → `npm` → `cargo` → `pip` → `nix` → `mise` → GitHub release in priority order, picks the first that works, and falls back to a cached binary at `<skill>/bin/sg`.

### Symlink for active development

```bash
ln -s /path/to/your/clone ~/.agents/skills/ast-grep
```

### Other agents

- **Claude Code / OpenCode**: drop the directory under `~/.agents/skills/` (or `~/.config/opencode/skills/`) and the skill auto-registers via the `name` + `description` in `SKILL.md` frontmatter.
- **pi (`~/.senpi/agent`)**: not a `pi` extension — this is a skill. Pi consumes skills via `~/.agents/skills/` symlinks; the actual `pi-ast-grep` extension is at <https://github.com/code-yeongyu/pi-extensions>.
- **Direct CLI use**: `python3 ~/.agents/skills/ast-grep/scripts/ast_grep_helper.py <subcommand>`.

## Usage

```bash
# Search by AST pattern (the helper validates patterns offline first)
python3 scripts/ast_grep_helper.py search 'console.log($MSG)' --lang ts src/

# Rewrite (dry-run preview by default)
python3 scripts/ast_grep_helper.py replace 'console.log($MSG)' 'logger.info($MSG)' --lang ts src/

# Apply the rewrite (two-pass: preview JSON + then --update-all)
python3 scripts/ast_grep_helper.py replace 'console.log($MSG)' 'logger.info($MSG)' --lang ts src/ --apply

# Run YAML lint rules from sgconfig.yml
python3 scripts/ast_grep_helper.py scan src/

# Validate a pattern OFFLINE (no sg call, no filesystem)
python3 scripts/ast_grep_helper.py validate '\w+' --lang ts
# → exit 2: regex \w not supported. Use $VAR for identifiers.

# Doctor: check ast-grep binary availability
python3 scripts/ast_grep_helper.py doctor

# List built-in languages plus configured custom languages
python3 scripts/ast_grep_helper.py langs

# Install / re-install the ast-grep binary
python3 scripts/ast_grep_helper.py install
```

See [SKILL.md](./SKILL.md) for full agent-facing usage and the [`references/`](./references/) directory for deep dives.

## Project layout

```
ast-grep-skill/
├── SKILL.md                       agent-facing skill (loaded by Claude Code, OpenCode, pi, etc.)
├── README.md                      this file
├── LICENSE                        MIT
├── install.sh                     POSIX installer (macOS / Linux / WSL / Git Bash)
├── install.ps1                    Windows PowerShell installer
├── scripts/
│   └── ast_grep_helper.py         single-file Python 3 stdlib wrapper
├── references/
│   ├── install.md                 per-OS install methods + manual fallback
│   ├── patterns.md                meta-variables ($VAR, $$$) and pattern syntax
│   ├── pitfalls.md                regex anti-patterns + language-specific traps
│   ├── recipes.md                 copy-paste patterns by language (TS/JS/Py/Go/Rust/...)
│   ├── cli.md                     sg run / scan / test / new / lsp reference
│   ├── yaml-rules.md              YAML rule schema (atomic / relational / composite / transform / fix)
│   └── sgconfig.md                project configuration (ruleDirs, testConfigs, utilDirs)
├── tests/
│   ├── smoke.sh                   POSIX self-test
│   └── smoke.ps1                  PowerShell self-test (Windows CI)
└── .github/workflows/ci.yml       matrix CI: macos / ubuntu / windows × py 3.9-3.13
```

## What it does

1. **Wraps `sg`** with a single Python 3 stdlib script that works the same on macOS, Linux, Windows, WSL, Git Bash.
2. **Validates patterns offline** before calling `sg` — catches the regex-misuse class of mistakes (`\w`, `.*`, `|`, `[a-z]`) plus language-specific traps (Python trailing colons, JS/Go/Rust missing function bodies).
3. **Resolves the binary** through 6 candidate paths: cached → PATH (with Linux `setgroups` collision detection) → Homebrew. Falls through to a clear install hint with copy-paste commands.
4. **Runs the two-pass write trick** when applying rewrites — `sg run` silently ignores `--update-all` when `--json` is set, so `replace --apply` runs two invocations: pass 1 collects JSON matches, pass 2 mutates files.
5. **Ships per-OS installers** that try every reasonable package manager and fall back to a GitHub release tarball.
6. **Documents the failure modes** the model will hit (regex misuse, incomplete patterns, `--update-all` + `--json` trap, scope/type questions ast-grep can't answer) in `references/pitfalls.md`.

## What it does NOT do

- No type inference, scope analysis, or data flow. ast-grep is a structural matcher; for type-aware questions use TypeScript LSP, Pyright, Semgrep with type inference, or CodeQL.
- No multi-repo federation. Run the helper once per repo.
- No automatic `sgconfig.yml` discovery — it does what `sg scan` does (walk up from cwd looking for one).
- No JS/Python rewriter authoring environment — for that, write YAML rules and use `sg test` for snapshot testing (see [`references/yaml-rules.md`](./references/yaml-rules.md)).

## Limits

- 5-minute timeout per `sg` invocation (configurable in the helper).
- ast-grep itself supports 25 languages out-of-the-box. For anything else, use [`customLanguages`](./references/sgconfig.md#customlanguages-experimental) in `sgconfig.yml`; the helper also accepts comma-separated overrides via `OMO_AST_GREP_EXTRA_LANGUAGES`.
- Pattern hint detection is heuristic; pass `--force` to skip validation when you know the pattern is correct.

## Requirements

- Python ≥ 3.9 (stdlib only — no pip install).
- `ast-grep` binary, installed via `install.sh` / `install.ps1` or one of:
  - `brew install ast-grep` (macOS / linuxbrew)
  - `npm install -g @ast-grep/cli` (any OS with Node)
  - `cargo install ast-grep --locked` (any OS with Rust)
  - `pip install ast-grep-cli` (any OS with Python)
  - `scoop install main/ast-grep` (Windows)

For older systems and Windows-specific setup, see [`references/install.md`](./references/install.md).

## Testing

```bash
bash tests/smoke.sh        # POSIX (macOS / Linux / WSL / Git Bash)
pwsh tests/smoke.ps1       # Windows (PowerShell 5.1+ or 7+)
```

CI runs the matrix on every push: `{macos-latest, ubuntu-latest, ubuntu-22.04, windows-latest}` × `{Python 3.9, 3.10, 3.11, 3.12, 3.13}` plus a syntax-floor check on Python 3.9 and 3.10.

## License

[MIT](./LICENSE).

## Acknowledgments

- [`omo` (oh-my-opencode)](https://github.com/code-yeongyu/oh-my-opencode) — `src/tools/ast-grep/` is the original tool implementation; this skill is a port of its pattern-hint detection and two-pass-write strategy.
- [`pi-extensions/pi-ast-grep`](https://github.com/code-yeongyu/pi-extensions) — sibling Node port; the helper's binary-resolution cascade is modelled on it.
- [ast-grep](https://github.com/ast-grep/ast-grep) — the CLI. All structural matching power comes from it.
- [Anthropic skills](https://docs.anthropic.com/en/docs/claude-code/skills) — the `SKILL.md` + `references/` packaging convention.
