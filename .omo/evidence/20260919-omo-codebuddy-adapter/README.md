# Evidence — omo-codebuddy adapter (2026-09-19)

QA for the new `packages/omo-codebuddy/` adapter, driven through
`.agents/skills/codebuddy-qa/scripts/drive.mjs` (the `codebuddy-qa` skill).

## What was tested

| Artifact | Command | Proves |
|---|---|---|
| `00-root.txt` | `mktemp -d` | the throwaway root used by the first install run |
| `01-isolation-before.json` | `drive.mjs isolation` | sha256 baseline of the REAL `~/.codebuddy/settings.json` + `plugins/known_marketplaces.json` |
| `02-install.json` | `install-local.mjs install --root <throwaway>/.codebuddy --json` | the local marketplace materializes outside the real profile |
| `03-hooks.json` | `drive.mjs hooks` | real payloads into the BUILT bundle |
| `04-probe.json` | `drive.mjs probe` | which CodeBuddy binaries exist, their identity, `plugin validate` result |
| `05-isolation-after.json` | `drive.mjs isolation --root <throwaway>/.codebuddy` | the real profile digests are unchanged |
| `06-format-parity.json` | `drive.mjs format-parity` | our manifest/hook shape vs the plugins CodeBuddy actually loads |
| `07-install-cycle.json` | `drive.mjs install` | install → installed copy runs → uninstall → throwaway root clean |
| `08-pre-session-isolation.json` | `drive.mjs isolation` | profile digests before the live-session attempt |
| `09-live-session.json` | `drive.mjs session --home real` | live turn result (PENDING — not signed in) |
| `10-plugin-help.json` | `drive.mjs cli --args "plugin --help"` | the agent CLI's real `plugin` subcommand surface |
| `11-plugin-list.json` | `drive.mjs cli --args "plugin list"` | real profile has no CLI plugins installed |
| `12-isolated-home.txt` | `mktemp -d` | the throwaway HOME used for the CLI lifecycle |
| `13-marketplace-materialize.json` | `install-local.mjs install --root <TMPH>/.codebuddy --json` | marketplace materialized (copy mode) |
| `14-marketplace-add.json` | `drive.mjs cli --home "$TMPH" --args "plugin marketplace add …"` | CodeBuddy ACCEPTS our `marketplace.json` |
| `15-plugin-install.json` | `… --args "plugin install omo@omo-local"` | CodeBuddy installs the plugin |
| `16-plugin-list.json` | `… --args "plugin list"` | `omo@omo-local` 5.0.0-beta.78, user scope, enabled |
| `17-marketplace-list.json` | `… --args "plugin marketplace list"` | `omo-local` registered as a directory marketplace |
| `18-plugin-list-json.json` | `… --args "plugin list --json"` | the versioned install path inside the throwaway profile |
| `19-plugin-uninstall.json` | `… --args "plugin uninstall omo@omo-local"` | clean uninstall |
| `20-marketplace-remove.json` | `… --args "plugin marketplace remove omo-local"` | clean marketplace removal |
| `21-plugin-list-after.json` | `… --args "plugin list"` | back to "No plugins installed" |

Hermetic gate run alongside:

```
bun test packages/omo-codebuddy                            → 59 pass / 0 fail
bunx tsgo --noEmit -p packages/omo-codebuddy/tsconfig.json → clean
bun scripts/build-plugin.mjs                               → 18 skills, 7 agents, 9 commands, mcp: context7 + grep_app
```

## What was observed

### 1. Hooks — the BUILT bundle, real CodeBuddy payloads (`03-hooks.json`)

- `user-prompt-submit` with `"ulw fix the failing test"` → exit 0, 1355 bytes,
  `hookSpecificOutput.additionalContext` contains `<ultrawork-mode>`.
- `session-start` → 663 bytes, `<omo-workflows>` + the workflow list.
- `stop` with no omo state → exit 0, EMPTY stdout (silent by design).
- `post-tool-use` on an edit → exit 0, empty stdout (no `comment-checker`
  binary installed, so the hook stays silent).
- `stop_unfinished_work` (unfinished Boulder plan owned by
  `codebuddy:qa-session`) → `{"continue":false,"reason":"The ulw-execute work
  plan for this session is still unfinished…"}` — CodeBuddy's stop-blocking
  shape, NOT the deprecated `decision:"block"`.

### 2. Real CodeBuddy Code CLI — full plugin lifecycle in a throwaway HOME

CLI: `@tencent-ai/codebuddy-code` v2.155.0 (`codebuddy`/`cbc`), installed for
this QA. Sequence, all WITHOUT authentication:

```
plugin validate  → "Validating plugin manifest: …/plugin/.codebuddy-plugin/plugin.json
                    ✔ Validation passed  {"valid": true, "type": "plugin"}"
marketplace add  → "✔ Marketplace 'omo-local' added successfully {"name":"omo-local","type":"directory"}"
plugin install   → "✔ Successfully installed plugin: omo@omo-local"
plugin list      → "Installed plugins: > omo@omo-local  Version: 5.0.0-beta.78  Scope: user  Status: enabled"
plugin list --json → installPath = <TMPH>/.codebuddy/plugins/cache/omo-local/omo/5.0.0-beta.78
uninstall        → "✔ Successfully uninstalled plugin: omo@omo-local"
marketplace remove → "✔ Marketplace 'omo-local' removed successfully"
plugin list      → "No plugins installed."
```

The materialized snapshot contains exactly what the build produced:
`hooks/scripts/hook.mjs` (30185 bytes), `hooks/hooks.json`,
`.codebuddy-plugin/plugin.json`, 18 skills, 7 agents, 9 commands,
`.mcp.json`, `README.md`.

**A real defect was found and fixed by this run:** the first install attempt
failed with `Plugin source path escapes marketplace root` because the installer
symlinked the checkout into the marketplace. CodeBuddy requires the plugin
source to live inside the marketplace root, so `install-local.mjs` now COPIES by
default (`--link` is inspection-only). Artifacts 13–21 are the post-fix run.

### 3. Format parity (`06-format-parity.json`)

100+ installed plugins sampled across `cb_teams_marketplace` and
`codebuddy-plugins-official`: `unknownManifestKeys: []`,
`unknownHookEvents: []`, `ok: true` — our manifest keys and hook event names are
a subset of what CodeBuddy really loads.

### 4. Installer cycle in a throwaway root (`07-install-cycle.json`)

install (copy) → the INSTALLED copy's bundled hook runs and injects ultrawork
(`installedPluginRuns: true`) → uninstall → `marketplace: false`, `plugin: false`,
settings entry gone.

### 5. Isolation

Real `~/.codebuddy/settings.json` sha256
`1b87282c077b92cdbd1f4084cc8941a09896f3ce048861d2b6774bf8cd4c4d6a` and
`known_marketplaces.json` sha256
`10abf60f6cc11b7b93a3452b5e012d0b36165210bcf4dc461ed1b010e9d6b7b8` are
IDENTICAL before and after every run (`01`, `05`, `08`).

### 6. NOT verified — live model turn (`09-live-session.json`)

```
Authentication required. Please use /login command to sign in to your account
```

The CLI is installed but not signed in, so a live turn cannot run; no env var or
copied credential substitutes for the login. This is recorded as **PENDING**,
not as a pass. Everything up to the host boundary — hook contract, bundle
execution, manifest shape, marketplace acceptance, install/enable, materialized
snapshot — is verified.

## Why it is enough

- Every hook was driven with the exact stdin shape CodeBuddy documents
  (`hook_event_name`, `prompt`, `cwd`, `session_id`, `stop_hook_active`,
  `tool_name`/`tool_input`/`tool_response`) against the BUILT bundle.
- The plugin was installed by the REAL CLI into a real (throwaway) CodeBuddy
  profile and reported `enabled: true`; the snapshot CodeBuddy materialized was
  inspected field by field.
- Manifest/hook shapes are a proven subset of the plugins CodeBuddy already
  loads, so an unknown key or event cannot slip through.
- Isolation is proven by digest, not claimed.

Residual risk (all covered by the manual step below):

1. A live turn was not observed (login required) — the hook's context injection
   is proven at the process/output level, not at the model level.
2. `comment-checker` findings were not observed live (binary not installed); the
   mapping onto `comment-checker-core` is covered by unit tests, and the
   silent path is proven here.
3. `lsp` / `ast-grep` MCP servers are intentionally declared only once their
   runtime is staged under `plugin/runtime/`; only the two remote servers ship
   today.

## What was omitted

- Credentials, auth headers, and the raw contents of `~/.codebuddy/mcp.json`:
  never read into evidence; only sha256 digests of profile files are recorded.
- `codebuddy --help` was truncated to 2500 chars in `04-probe.json` (the full
  text carries no project data).
- Session transcripts/JSONL: none exist (no live turn ran).

## Manual step for the user (pending, not claimed)

```bash
codebuddy            # → /login, then quit
node .agents/skills/codebuddy-qa/scripts/drive.mjs session --home real --debug hooks \
  --prompt "ulw probe: reply with exactly ULTRAWORK MODE ENABLED! and nothing else."
```

In the IDE: `/plugin marketplace add <repo>/packages/omo-codebuddy/plugins/omo-local`… or simply
`codebuddy plugin marketplace add <abs path>` + `/plugin install omo@omo-local`.
