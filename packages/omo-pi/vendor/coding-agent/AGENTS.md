# packages/coding-agent

`@code-yeongyu/senpi` — primary fork target. The CLI app users actually run (`senpi`). Highest merge-conflict surface against upstream `pi-mono`. **Always reach for the extension API before touching anything in `src/core/`**.

## STRUCTURE

```
src/
├── cli.ts                     # Thin bootstrap — sets process.title, handles --version, runs bundled-dep self-update check, spawns a child node process running cli-main.ts
├── cli-main.ts                # Full CLI entry — configures undici dispatcher timeouts (configureHttpDispatcher), calls main()
├── main.ts                    # Arg parse → model resolution → mode dispatch
├── index.ts                   # Public API (AgentSession, AuthStorage, compaction, extension types, tools)
├── config.ts                  # APP_NAME, VERSION, configDir/cacheDir/sessionDir resolvers
├── migrations.ts              # Settings/session schema migrations (incl. `pi → senpi` rename)
├── package-manager-cli.ts     # `senpi update senpi`, package commands (install/list/remove)
├── self-update-bootstrap.ts   # Bootstrap self-update when bundled workspace deps are missing
├── changes.md                 # Fork tracker (root-level src changes)
├── bun/                       # Bun binary entry (cli.ts, register-bedrock.ts, restore-sandbox-env.ts)
├── cli/                       # args.ts, file-processor.ts, initial-message.ts, list-models.ts, session-picker.ts, config-selector.ts
├── core/                      # PRIMARY FORK SURFACE — see below
│   ├── agent-session.ts       # Session lifecycle, event emission, runtime — the package's largest file
│   ├── extensions/            # Extension API: types.ts, loader, runner, builtin/ — see AGENTS.md
│   ├── tools/                 # Built-in tools (bash/edit/grep/find/ls/read/write) — see AGENTS.md
│   ├── compaction/            # Plugsuit-style compaction policy — see changes.md
│   ├── dynamic-prompt/        # buildDynamicSystemPrompt() — see changes.md
│   ├── export-html/           # session → HTML transcript renderer
│   ├── auth-{guidance,storage}.ts, sdk.ts, model-{registry,resolver}.ts, settings-manager.ts, …
│   └── changes.md             # Core-level fork changes
├── modes/
│   ├── interactive/           # TUI mode — see AGENTS.md (components/ + interactive-mode.ts)
│   ├── rpc/                   # JSONL RPC server (rpc-mode.ts, rpc-client.ts, jsonl.ts, rpc-types.ts)
│   └── print-mode.ts          # One-shot non-interactive mode
└── utils/                     # git, mime, clipboard, image, photon, version-check, …

docs/                          # User-facing docs at the package root (extensions.md is the extension API ref)

test/
├── suite/
│   ├── harness.ts             # MODERN test harness — use this
│   └── regressions/           # `<issue-number>-<slug>.test.ts` for upstream issues
├── test-harness.ts            # Legacy harness
└── (~120 standalone .test.ts files)
```

## WHERE TO LOOK

| Task | First-choice path | Notes |
|------|-------------------|-------|
| Add tool | `src/core/extensions/builtin/<name>/` | Use `pi.registerTool()`. Core `tools/` only for upstream-parity edits. |
| Add slash command | builtin extension | `pi.registerCommand()`. Never edit `src/core/slash-commands.ts`. |
| Add CLI flag | builtin extension `pi.registerFlag()` | Or `src/cli/args.ts` if it must mirror upstream behavior |
| Modify session lifecycle | `src/core/agent-session.ts` | High-conflict; document any change in `core/changes.md` |
| Replace system prompt | extension `before_agent_start` | Or `src/core/dynamic-prompt/build.ts` (already modified — see `changes.md`) |
| Custom compaction logic | extension `on("session_before_compact")` | Or `src/core/compaction/` for policy constants |
| Add TUI component | `src/modes/interactive/components/` | Match the style of the existing components |
| Add regression test | `test/suite/regressions/<issue>-<slug>.test.ts` | Use `test/suite/harness.ts`, never real APIs |

## EXTENSION LIFECYCLE (1-line each)

1. **Discovery**: builtin (`builtin/index.ts`) + `.pi/extensions/` (legacy project path), `.senpi/extensions/`, `~/.senpi/agent/extensions/`, `settings.json` paths, `-e` CLI flag.
2. **Loading**: `extensions/loader.ts` — single shared `jiti` importer (`changes.md` 2026-05-08), aliases `@mariozechner/pi-*` → workspace packages.
3. **Factory**: `export default function(pi: ExtensionAPI) { … }` runs at load time.
4. **Binding**: `ExtensionRunner.bindCore()` connects `pi.*` stubs to real implementations.
5. **Events**: `session_start` → `resources_discover` → tool/command/UI events → `session_shutdown`.
6. **Reload**: `session_shutdown` → reload changed files → re-run factories → `session_start({ reason: "reload" })`.

## CONVENTIONS

- **Tool shape**: TypeBox schema + `execute(input, ctx)` + `renderCall` + `renderResult`. Match `core/tools/` patterns; see `core/tools/AGENTS.md`.
- **No built-in MCP / permission popups / plan mode / todos in core** — pi philosophy. The fork's `permission-system`, `compaction`, `prompt-preset`, and `todowrite` features live as **builtin extensions**, not core.
- **Keybindings always configurable** — `KEYBINDINGS` (`src/core/keybindings.ts`, spreads `TUI_KEYBINDINGS` from `@earendil-works/pi-tui` and adds the `app.*` bindings) is the source of truth.
- **Faux provider for tests** — never spend a real token in `npm test`. Use `harness.ts` + `pi-ai/faux`.
- **Inlined UUIDv7 in `core/session-manager.ts`** — do NOT re-add the `uuid` package. Documented in `changes.md` 2026-04-17.
- **Branding**: package name `@code-yeongyu/senpi`, app name `senpi`, configDir `.senpi`. Self-update target is `code-yeongyu/senpi`.

## ANTI-PATTERNS

- Touching `src/core/extensions/types.ts` without an `extensions/changes.md` entry — the public extension API is the fork's most-watched contract.
- Hardcoding key bindings.
- Real LLM API in tests.
- Adding "would-be-an-extension" features to `core/` — bloats merge surface and violates pi's philosophy.
- Re-running `prepublishOnly` to "fix" CI — it intentionally rebuilds dist + chmod's binaries; only run during release.
- Editing `dist/` checked-in stubs (none here, but see `packages/{mom,pods}/`).

## NOTES

- The MODERN test harness is `test/suite/harness.ts`. `test/test-harness.ts` is legacy and only kept for already-converted suites.
- Test docs: [`test/suite/README.md`](test/suite/README.md) (harness-based suite rules), [`test/integration/README.md`](test/integration/README.md) (API-key-gated live tests), [`test/fixtures/compaction/README.md`](test/fixtures/compaction/README.md) (per-feature compaction fixtures).
- `docs/extensions.md` is the extension capability reference. Read it before claiming "no extension hook can do X".
- `examples/extensions/` ships canonical extension reference implementations (sandbox, custom-provider-anthropic, custom-provider-gitlab-duo, with-deps).
- The Bun binary build (`build:binary`) compiles `dist/bun/cli.js` into a single executable; `copy-binary-assets` copies fonts/themes/templates into `dist/`.
