# Oh My OpenAgent Full Oh My Pi and Pi Port Context

Date: 2026-06-10
Status: Targeted certification refreshed on 2026-06-11. Chunks 0-29 complete. Full root suite was not rerun after the final fixes because the user explicitly requested targeted tests only.

## Mission

Port Oh My OpenAgent into both target harnesses with full native extension support:

- Oh My Pi: `@oh-my-pi/pi-coding-agent`
- Pi: `@earendil-works/pi-coding-agent`

This is not a command-only port or a small bridge. The target state is native load plus real dogfood of tools, hooks/events, commands, skills/resources, named agents, background/task features, MCP features where supported, session/continuation behavior, and target harness integration.

## Path contract

| Purpose | Path |
|---|---|
| Source extension repo | `/home/supreme/oh-my-openagent` |
| Oh My Pi source repo | `/home/supreme/pr-work/oh-my-pi` |
| Oh My Pi installed runtime | `/home/supreme/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent` |
| Oh My Pi extension root | `/home/supreme/.omp/agent/extensions` |
| Oh My Pi settings path if present | `/home/supreme/.omp/agent/settings.json` |
| Pi source repo | `/home/supreme/pi-mono` |
| Pi installed runtime | `/home/supreme/.bun/install/global/node_modules/@earendil-works/pi-coding-agent` |
| Pi extension root | `/home/supreme/.pi/agent/extensions` |
| Pi settings path if present | `/home/supreme/.pi/agent/settings.json` |
| Master PRD | `/home/supreme/oh-my-openagent/docs/porting/oh-my-openagent-full-omp-pi-port.md` |
| Living context | `/home/supreme/oh-my-openagent/docs/porting/CONTEXT.md` |

Executable resolution observed:

```text
omp -> /home/supreme/.bun/bin/omp -> /home/supreme/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts
pi  -> /home/supreme/.bun/bin/pi  -> /home/supreme/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/cli.js
```

## Decisions locked by user

1. Use the recommended architecture from research.
2. Keep Oh My OpenAgent core behavior in source packages.
3. Add host adapters for OpenCode, Oh My Pi, and Pi.
4. Share normalization code for tools, commands, skills/resources, events/hooks, config loading, and runtime paths.
5. Do not put all target-specific behavior into one huge extension file.
6. Runtime probes may patch installed runtimes, but durable fixes must land in source repos.
7. Package/discovery must support target-native manifests:
   - Oh My Pi: `omp.extensions`
   - Pi: `pi.extensions`
8. Use one package with both manifests if clean. Use separate adapter entrypoints in the same source repo if imports/APIs diverge.
9. Execute chunks one by one.
10. Do not use subagents.
11. Run focused checks after each chunk.
12. Run one final installed-runtime dogfood pass across both harnesses at the end.

## Research facts already observed

### Oh My OpenAgent

Current OpenCode surfaces:

- `tool`
- `config`
- `event`
- `chat.params`
- `chat.headers`
- `chat.message`
- `command.execute.before`
- `tool.definition`
- `tool.execute.before`
- `tool.execute.after`
- `experimental.chat.messages.transform`
- `experimental.chat.system.transform`
- `experimental.session.compacting`
- `experimental.compaction.autocontinue`
- `dispose`

Current source areas:

- `src/index.ts`
- `src/testing/create-plugin-module.ts`
- `src/plugin-interface.ts`
- `src/create-tools.ts`
- `src/create-hooks.ts`
- `src/create-managers.ts`
- `src/plugin/types.ts`
- `src/plugin/tool-registry*.ts`
- `src/tools`
- `src/hooks`
- `src/features`
- `src/config`
- `src/mcp`
- `.opencode`
- `.agents`

Named agents must be explicit in the port:

- `sisyphus`
- `sisyphus-junior`
- `hephaestus`
- `prometheus`
- `atlas`
- `metis`
- `momus`
- `oracle`
- `librarian`
- `explore`
- `multimodal-looker`

### Oh My Pi

Observed extension contract:

- Source imports use `@oh-my-pi/pi-coding-agent`.
- Extension factory shape is `export default function(pi: ExtensionAPI)`.
- Manifest supports `omp.extensions`, falling back to legacy `pi.extensions`.
- Native roots include `<cwd>/.omp/extensions` and `~/.omp/agent/extensions`.
- Installed runtime main is source TypeScript at `src/cli.ts`.
- `resources_discover` exists in extension types/runner, but no AgentSession callsite was found during research.
- Settings path `/home/supreme/.omp/agent/settings.json` was absent during research. `/home/supreme/.omp/agent/config.yml` existed.

Installed Oh My Pi extension examples observed:

- `/home/supreme/.omp/agent/extensions/harness-helper`
- `/home/supreme/.omp/agent/extensions/iteration-runner`

### Pi

Observed extension contract:

- Source imports use `@mariozechner/pi-coding-agent`.
- Installed runtime package is `@earendil-works/pi-coding-agent`.
- Extension factory shape is `export default function(pi: ExtensionAPI)`.
- Manifest supports `pi.extensions`.
- Native roots include `<cwd>/.pi/extensions` and `~/.pi/agent/extensions`.
- Installed runtime is built JavaScript at `dist/cli.js`.
- `resources_discover` is wired through `AgentSession.bindExtensions()` and `ResourceLoader.extendResources()`.
- Pi lacks some Oh My Pi events: `user_python`, `session.compacting`, auto-compaction/retry events, TTSR, todo reminder, goal update.

Installed Pi extension examples observed:

- `/home/supreme/.pi/agent/extensions/oh-my-pi.ts`
- `/home/supreme/.pi/agent/extensions/iteration-runner.ts`

The existing `/home/supreme/.pi/agent/extensions/oh-my-pi.ts` is a partial hook bridge and may conflict with the full port. Do not remove it without an explicit migration step in the install/packaging chunk.

## Current files touched

The planning chunk created:

- `/home/supreme/oh-my-openagent/docs/porting/oh-my-openagent-full-omp-pi-port.md`
- `/home/supreme/oh-my-openagent/docs/porting/CONTEXT.md`

Chunk 1 updated:

- `/home/supreme/oh-my-openagent/docs/porting/oh-my-openagent-full-omp-pi-port.md`
- `/home/supreme/oh-my-openagent/docs/porting/CONTEXT.md`

Chunk 2 added:

- `/home/supreme/oh-my-openagent/src/host-contract/index.ts`
- `/home/supreme/oh-my-openagent/src/host-contract/host-kind.ts`
- `/home/supreme/oh-my-openagent/src/host-contract/host-config.ts`
- `/home/supreme/oh-my-openagent/src/host-contract/host-session.ts`
- `/home/supreme/oh-my-openagent/src/host-contract/host-tool.ts`
- `/home/supreme/oh-my-openagent/src/host-contract/host-command.ts`
- `/home/supreme/oh-my-openagent/src/host-contract/host-resource.ts`
- `/home/supreme/oh-my-openagent/src/host-contract/host-event.ts`
- `/home/supreme/oh-my-openagent/src/host-contract/host-runtime.ts`

Chunk 3 added:

- `/home/supreme/oh-my-openagent/src/host-runtime/index.ts`
- `/home/supreme/oh-my-openagent/src/host-runtime/runtime-paths.ts`
- `/home/supreme/oh-my-openagent/src/host-runtime/settings-file.ts`
- `/home/supreme/oh-my-openagent/src/host-runtime/config-roots.ts`
- `/home/supreme/oh-my-openagent/src/host-runtime/config-roots.test.ts`

Chunk 4 added:

- `/home/supreme/oh-my-openagent/src/hosts/oh-my-pi/index.ts`
- `/home/supreme/oh-my-openagent/src/hosts/oh-my-pi/extension-api.ts`
- `/home/supreme/oh-my-openagent/src/hosts/oh-my-pi/manifest.ts`
- `/home/supreme/oh-my-openagent/src/hosts/oh-my-pi/register-diagnostics.ts`
- `/home/supreme/oh-my-openagent/src/hosts/oh-my-pi/register-diagnostics.test.ts`

Chunk 5 added:

- `/home/supreme/oh-my-openagent/src/hosts/pi/index.ts`
- `/home/supreme/oh-my-openagent/src/hosts/pi/extension-api.ts`
- `/home/supreme/oh-my-openagent/src/hosts/pi/manifest.ts`
- `/home/supreme/oh-my-openagent/src/hosts/pi/register-diagnostics.ts`
- `/home/supreme/oh-my-openagent/src/hosts/pi/register-diagnostics.test.ts`

Chunk 6 added:

- `/home/supreme/oh-my-openagent/src/host-tools/index.ts`
- `/home/supreme/oh-my-openagent/src/host-tools/tool-schema.ts`
- `/home/supreme/oh-my-openagent/src/host-tools/tool-result.ts`
- `/home/supreme/oh-my-openagent/src/host-tools/tool-registration.ts`
- `/home/supreme/oh-my-openagent/src/host-tools/tool-normalization.test.ts`

Chunk 6 updated:

- `/home/supreme/oh-my-openagent/src/plugin/normalize-tool-arg-schemas.ts`

Chunk 4 and Chunk 5 updated:

- `/home/supreme/oh-my-openagent/package.json`

Final implementation additionally touched:

- `/home/supreme/oh-my-openagent/src/host-tools/mcp-backed-tools.ts`
- `/home/supreme/oh-my-openagent/src/host-tools/background-manager.ts`
- `/home/supreme/oh-my-openagent/src/host-tools/always-on-tools.ts`
- `/home/supreme/oh-my-openagent/src/host-tools/task-tools.ts`
- `/home/supreme/oh-my-openagent/src/host-tools/team-tools.ts`
- `/home/supreme/oh-my-openagent/src/host-mcp/*`
- `/home/supreme/oh-my-openagent/src/host-hooks/*`
- `/home/supreme/oh-my-openagent/src/host-agents/*`
- `/home/supreme/oh-my-openagent/src/host-resources/*`
- `/home/supreme/oh-my-openagent/src/cli/install-targets/*`
- `/home/supreme/oh-my-openagent/src/cli/cli-program.ts`
- `/home/supreme/oh-my-openagent/src/plugin/normalize-tool-arg-schemas.ts`
- `/home/supreme/pr-work/oh-my-pi/packages/coding-agent/src/sdk.ts`
- `/home/supreme/pr-work/oh-my-pi/packages/coding-agent/src/config/prompt-templates.ts`
- `/home/supreme/pr-work/oh-my-pi/packages/coding-agent/src/discovery/helpers.ts`
- `/home/supreme/pr-work/oh-my-pi/packages/coding-agent/test/sdk-skills.test.ts`

Installed runtime probe patch:

- `/home/supreme/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/discovery/helpers.ts`

Why the installed runtime was patched:

- Oh My Pi installed runtime did not discover the symlinked package directory `/home/supreme/.omp/agent/extensions/oh-my-openagent-dev` through native discovery because extension module discovery used glob matches that did not follow symlinked package directories. The durable source patch is in `/home/supreme/pr-work/oh-my-pi/packages/coding-agent/src/discovery/helpers.ts`.

## Selected adapter paths

Chunk 1 chose the implementation paths below from the live source layout.

### Oh My OpenAgent source

Keep current OpenCode entry behavior in place:

- `src/index.ts`
- `src/testing/create-plugin-module.ts`
- `src/plugin-interface.ts`

Add host-neutral contracts in small topic files:

- `src/host-contract/index.ts`
- `src/host-contract/host-kind.ts`
- `src/host-contract/host-runtime.ts`
- `src/host-contract/host-session.ts`
- `src/host-contract/host-tool.ts`
- `src/host-contract/host-command.ts`
- `src/host-contract/host-resource.ts`
- `src/host-contract/host-event.ts`
- `src/host-contract/host-config.ts`

Add runtime path and config helpers:

- `src/host-runtime/index.ts`
- `src/host-runtime/config-roots.ts`
- `src/host-runtime/runtime-paths.ts`
- `src/host-runtime/settings-file.ts`

Add tool normalization:

- `src/host-tools/index.ts`
- `src/host-tools/tool-schema.ts`
- `src/host-tools/tool-result.ts`
- `src/host-tools/tool-registration.ts`

Add hook and event normalization:

- `src/host-hooks/index.ts`
- `src/host-hooks/event-map.ts`
- `src/host-hooks/hook-dispatch.ts`
- `src/host-hooks/provider-events.ts`
- `src/host-hooks/session-events.ts`

Add command, skill, and resource normalization:

- `src/host-resources/index.ts`
- `src/host-resources/command-registration.ts`
- `src/host-resources/resource-discovery.ts`
- `src/host-resources/skill-paths.ts`
- `src/host-resources/agent-resources.ts`

Add native target adapters:

- `src/hosts/oh-my-pi/index.ts`
- `src/hosts/oh-my-pi/extension-api.ts`
- `src/hosts/oh-my-pi/manifest.ts`
- `src/hosts/oh-my-pi/register-diagnostics.ts`
- `src/hosts/pi/index.ts`
- `src/hosts/pi/extension-api.ts`
- `src/hosts/pi/manifest.ts`
- `src/hosts/pi/register-diagnostics.ts`

Do not add `src/hosts/opencode/` in Chunk 2. The current OpenCode adapter is already centralized through `src/testing/create-plugin-module.ts` and `src/plugin-interface.ts`; moving it before the shared contract exists would add churn without increasing port support. Add an OpenCode host wrapper only when a later chunk has a concrete shared-contract callsite to route through.

### Target source repos

Oh My Pi durable source files to patch only when a later chunk proves a missing seam:

- `/home/supreme/pr-work/oh-my-pi/packages/coding-agent/src/extensibility/extensions/types.ts`
- `/home/supreme/pr-work/oh-my-pi/packages/coding-agent/src/extensibility/extensions/loader.ts`
- `/home/supreme/pr-work/oh-my-pi/packages/coding-agent/src/extensibility/extensions/runner.ts`
- `/home/supreme/pr-work/oh-my-pi/packages/coding-agent/src/extensibility/extensions/wrapper.ts`
- `/home/supreme/pr-work/oh-my-pi/packages/coding-agent/src/session/agent-session.ts`

Pi durable source files to patch only when a later chunk proves a missing seam:

- `/home/supreme/pi-mono/packages/coding-agent/src/core/extensions/types.ts`
- `/home/supreme/pi-mono/packages/coding-agent/src/core/extensions/loader.ts`
- `/home/supreme/pi-mono/packages/coding-agent/src/core/extensions/runner.ts`
- `/home/supreme/pi-mono/packages/coding-agent/src/core/extensions/wrapper.ts`
- `/home/supreme/pi-mono/packages/coding-agent/src/core/agent-session.ts`
- `/home/supreme/pi-mono/packages/coding-agent/src/core/resource-loader.ts`

### Packaging paths for later chunks

Do not change package/build scripts until the adapter skeletons exist. Expected later edits:

- `package.json`
- `tsconfig.json`, only if multi-entry declarations require it
- build script command in `package.json`
- installer code under `src/cli/` only in the packaging chunk

## Live contract decisions

### Oh My Pi

The Oh My Pi extension factory is:

```ts
export default function extension(pi: ExtensionAPI) {
  // registration only at load time
}
```

The loader prefers `package.json` `omp.extensions` and falls back to `pi.extensions`. It also accepts `index.ts`, `index.js`, and one-level extension directory discovery.

Usable seams confirmed from source:

- `registerTool`
- `registerCommand`
- `registerShortcut`
- `registerFlag`
- `registerMessageRenderer`
- `registerProvider`
- lifecycle event handlers through `pi.on(...)`
- `tool_call` and `tool_result`
- `context`
- `before_agent_start`
- `before_provider_request`
- `after_provider_response`
- session events including `session.compacting`
- `resources_discover` in types and runner

Still needs later proof:

- The Oh My Pi `resources_discover` runner method exists, but Chunk 1 did not prove an `AgentSession` callsite invokes it. Chunk 14 or 15 must verify this before marking dynamic resources ported.

### Pi

The Pi extension factory is the same shape:

```ts
export default function extension(pi: ExtensionAPI) {
  // registration only at load time
}
```

The loader accepts only `package.json` `pi.extensions`, then `index.ts`, `index.js`, and one-level extension directory discovery.

Usable seams confirmed from source:

- `registerTool`
- `registerCommand`
- `registerShortcut`
- `registerFlag`
- `registerMessageRenderer`
- `registerProvider`
- lifecycle event handlers through `pi.on(...)`
- `tool_call` and `tool_result`
- `context`
- `before_agent_start`
- `before_provider_request`
- `after_provider_response`
- `resources_discover`
- dynamic post-start `registerTool` through `refreshTools()`

Important Pi differences:

- Source imports use `@mariozechner/pi-coding-agent`.
- Installed runtime package is `@earendil-works/pi-coding-agent`.
- Pi `ToolDefinition` includes extra fields such as `promptSnippet`, `promptGuidelines`, `renderShell`, `prepareArguments`, and `executionMode`.
- `resources_discover` is wired into `AgentSession` and `ResourceLoader.extendResources()`.

## Current seam classification

Chunk 1 did not patch target runtimes. Current classifications for upcoming work:

- Host contract and runtime path chunks: extension-source-only.
- Oh My Pi adapter skeleton: extension-source-only unless installed loader proof fails.
- Pi adapter skeleton: extension-source-only unless installed loader proof fails.
- Oh My Pi dynamic resources: possible runtime seam missing, pending source proof in Chunk 14.
- Pi dynamic resources: extension-source-only based on current source evidence.
- Packaging/discovery: packaging/discovery only, unless target loaders fail manifest discovery in installed-runtime probes.

## Checks run for current chunk

- Read `/home/supreme/oh-my-openagent/AGENTS.md`.
- Read `/home/supreme/oh-my-openagent/docs/AGENTS.md`.
- Checked `/home/supreme/oh-my-openagent/docs/porting`, which did not exist before this chunk.
- Wrote PRD and this context file.
- Read-back verification completed for PRD and context.

## Review findings for current chunk

- Documentation path is valid under `docs/porting` because user explicitly requested PRD and context there.
- `docs/AGENTS.md` says user-facing docs in `guide` and `reference` need `WHERE TO LOOK` updates. These planning docs are not in `guide` or `reference`.
- Root repo rule forbids em dash and en dash in generated content. Keep future edits ASCII-hyphen only.
- Root repo rule forbids catch-all implementation files. Future chunks must avoid `utils.ts`, `helpers.ts`, and `service.ts`.

## Blockers

None for planning.

## Next chunk

Chunk 12: Port named agents and categories.

Chunk 12 must:

1. Inspect agent factories, ordering, prompts, and policy metadata.
2. Represent all 11 named agents and categories in both target adapters.
3. Preserve canonical order where order exists.
4. Preserve Prometheus markdown-only policy metadata.
5. Add inventory and routing-policy checks.

## Running chunk log

### Chunk 0: Planning documents

Status: Complete.

What happened:

- Created the Master PRD.
- Created this living context file.
- Recorded user decisions and live research facts.
- Recorded chunk breakdown and acceptance criteria in the PRD.

Why:

- User explicitly required PRD, chunk list, and acceptance criteria before implementation.

Files touched:

- `docs/porting/oh-my-openagent-full-omp-pi-port.md`
- `docs/porting/CONTEXT.md`

Checks run:

- Documentation rules read.
- Porting directory absence confirmed before creation.
- Read back PRD start, PRD chunk and named-agent sections, and context start.
- Searched PRD and context for em dash and en dash characters. No matches.
- Searched PRD and context for banned filler terms. No matches.

Review findings:

- No implementation touched.
- Named agents are explicit.
- Final dogfood requirement is explicit.

Next:

- Start Chunk 1: Reconfirm live source contracts and choose adapter paths.

### Chunk 1: Reconfirm live source contracts and choose adapter paths

Status: Complete.

What happened:

- Re-read the root roadmap and goal.
- Re-read the Master PRD and this context.
- Re-read docs rules under `docs/AGENTS.md`.
- Re-read target repo instructions:
  - `/home/supreme/pr-work/oh-my-pi/AGENTS.md`
  - `/home/supreme/pi-mono/AGENTS.md`
- Re-read Oh My OpenAgent entry and package/build files:
  - `package.json`
  - `tsconfig.json`
  - `src/AGENTS.md`
  - `src/index.ts`
  - `src/testing/create-plugin-module.ts`
- Re-read target extension contracts:
  - Oh My Pi extension `types.ts`, `loader.ts`, `runner.ts`, `wrapper.ts`, `agent-session.ts`, and docs search results.
  - Pi extension `types.ts`, `loader.ts`, `runner.ts`, `wrapper.ts`, `agent-session.ts`, `resource-loader.ts`, and docs search results.
- Chose exact adapter and shared-contract paths.
- Updated the PRD Chunk 1 status.

Why:

- The user required tiny sequential chunks with per-chunk context updates.
- The next implementation chunk needs stable source paths before new files appear.
- Target harness APIs are similar enough to share normalization, but different enough to require separate target entrypoints.

Files touched:

- `docs/porting/oh-my-openagent-full-omp-pi-port.md`
- `docs/porting/CONTEXT.md`

Checks run:

- `sed -n '1,260p' ROADMAP.md`
- `sed -n '1,260p' docs/GOAL.md`
- `git status --short`
- `sed -n '1,980p' docs/porting/oh-my-openagent-full-omp-pi-port.md` in ranges
- `sed -n '1,260p' docs/porting/CONTEXT.md`
- `find docs/porting -maxdepth 2 -type f -print`
- `find /home/supreme/pr-work/oh-my-pi -name AGENTS.md -print`
- `find /home/supreme/pi-mono -name AGENTS.md -print`
- `sed -n '1,220p' /home/supreme/pr-work/oh-my-pi/AGENTS.md`
- `sed -n '1,220p' /home/supreme/pi-mono/AGENTS.md`
- `sed -n '1,220p' docs/AGENTS.md`
- `sed -n '1,220p' package.json`
- `sed -n '1,220p' tsconfig.json`
- `sed -n '1,220p' src/index.ts`
- `sed -n '1,260p' src/testing/create-plugin-module.ts`
- `find src -maxdepth 2 -type d | sort`
- `rg` searches for host, adapter, target extension, manifest, event, resource, tool, and command seams in all three repos
- Targeted `sed` reads of Oh My Pi and Pi extension contract files

Review findings:

- No code behavior changed.
- OpenCode behavior remains untouched.
- `src/index.ts` is intentionally left as the OpenCode package entry.
- Adding `src/hosts/opencode/` before a shared-contract callsite would be churn, so it is deferred.
- Oh My Pi and Pi should use separate adapter entrypoints because imports, loader implementation, and tool definition details diverge.
- Chunk 2 can proceed as extension-source-only work in Oh My OpenAgent.

Blockers:

- None.

Installed runtime probe notes:

- None. Chunk 1 was read-only by design.

Next:

- Start Chunk 2: Add host contract interfaces.

### Chunk 2: Add host contract interfaces

Status: Complete.

What happened:

- Added the first shared host-neutral contract layer under `src/host-contract/`.
- Defined host identity and package family types.
- Defined JSON-safe config values and host config root/source snapshots.
- Defined normalized session messages, session actions, compaction options, context usage, and session context.
- Defined normalized tool content, results, updates, execution requests, tool definitions, and tool registry behavior.
- Defined normalized command completions, command context, command handler, command definitions, and command registry behavior.
- Defined resource kinds, resource paths, discovery requests/results, diagnostics, and provider behavior.
- Defined normalized event names, specialized event payloads, event results, and event registry behavior.
- Defined runtime capabilities and host adapter factory shape.
- Tightened `HostEvent` after review so broad base events do not swallow specialized event narrowing.

Why:

- Later adapters need one small shared vocabulary before path normalization, tool registration, hooks, and resources can be implemented without target-specific type sprawl.
- The chunk deliberately avoided behavior wiring so OpenCode remains untouched and target adapters are not half-started.

Files touched:

- `src/host-contract/index.ts`
- `src/host-contract/host-kind.ts`
- `src/host-contract/host-config.ts`
- `src/host-contract/host-session.ts`
- `src/host-contract/host-tool.ts`
- `src/host-contract/host-command.ts`
- `src/host-contract/host-resource.ts`
- `src/host-contract/host-event.ts`
- `src/host-contract/host-runtime.ts`
- `docs/porting/oh-my-openagent-full-omp-pi-port.md`
- `docs/porting/CONTEXT.md`

Checks run:

- `bun run typecheck` before dependency install failed because `node_modules` was absent and `tsgo` was not on PATH.
- `bun install` installed dependencies and ran the repo `prepare` build.
- `bun run typecheck` passed after install.
- `rg -n "\bany\b|@ts-ignore|@ts-expect-error|[\u2013\u2014]" src/host-contract` returned no matches.
- `git status --short` showed only untracked goal/porting docs and `src/host-contract/`.

Review findings:

- No target runtime files were patched.
- No target source repos were patched.
- No package or build scripts were changed.
- No OpenCode behavior was changed.
- The contract layer has no executable behavior and no catch-all files.
- `bun install` did not leave tracked file modifications in `git status`.

Blockers:

- None.

Installed runtime probe notes:

- None. Chunk 2 was source type work only.

Next:

- Start Chunk 3: Add runtime path and config normalization.

### Chunk 3: Add runtime path and config normalization

Status: Complete.

What happened:

- Added `src/host-runtime/` as the path/config normalization layer.
- Added `resolveHostRuntimePaths()` for OpenCode, Oh My Pi, and Pi.
- Added settings candidate ordering for:
  - OpenCode `oh-my-openagent` and legacy `oh-my-opencode` config files.
  - Oh My Pi `settings.json`, `config.yml`, `config.yaml`, and project settings.
  - Pi user and project `settings.json`.
- Added `createHostConfigRoot()` and `createHostConfigRoots()`.
- Added focused tests covering target roots, missing settings, existing Oh My Pi `config.yml`, multi-host root creation, settings candidate ordering, and OpenCode explicit config dir preservation.

Why:

- The next adapter chunks need deterministic roots for extension discovery, config loading, and installed-runtime probes.
- Missing settings files are normal in the path contract, especially for Oh My Pi, so absence must be represented as no settings path rather than an error.
- OpenCode behavior stays anchored to the existing resolver when no explicit config dir is injected.

Files touched:

- `src/host-runtime/index.ts`
- `src/host-runtime/runtime-paths.ts`
- `src/host-runtime/settings-file.ts`
- `src/host-runtime/config-roots.ts`
- `src/host-runtime/config-roots.test.ts`
- `docs/porting/oh-my-openagent-full-omp-pi-port.md`
- `docs/porting/CONTEXT.md`

Checks run:

- `bun test src/host-runtime/config-roots.test.ts` passed: 8 tests, 17 assertions.
- `bun run typecheck` passed.
- `rg -n "\bany\b|@ts-ignore|@ts-expect-error|[\u2013\u2014]|utils\.ts|helpers\.ts|service\.ts" src/host-runtime src/host-contract` returned no matches.
- `git status --short` showed only untracked goal/porting docs, `src/host-contract/`, and `src/host-runtime/`.

Review findings:

- No target runtime files were patched.
- No target source repos were patched.
- No OpenCode wiring changed.
- OpenCode path behavior defaults to `getOpenCodeConfigPaths({ binary: "opencode", version: null })`.
- Tests use injected roots and fake existence checks, so they do not depend on the current machine's home directory state.

Blockers:

- None.

Installed runtime probe notes:

- None. Chunk 3 was source path/config work only.

Next:

- Start Chunk 4: Add Oh My Pi adapter entrypoint skeleton.

### Chunk 4: Add Oh My Pi adapter entrypoint skeleton

Status: Complete.

What happened:

- Added a native Oh My Pi adapter skeleton under `src/hosts/oh-my-pi/`.
- Kept the adapter diagnostic-only.
- Added structural local Oh My Pi API types so Oh My OpenAgent does not need a compile-time dependency on `@oh-my-pi/pi-coding-agent`.
- Added constants for the Oh My Pi extension entry, label, command, and tool.
- Added `registerOhMyPiDiagnostics()` to register:
  - label `Oh My OpenAgent`
  - command `omo-diagnostic`
  - tool `omo_diagnostic`
- Added a focused unit test proving the skeleton registers those diagnostic surfaces.
- Added root `package.json` `omp.extensions` pointing at `./dist/hosts/oh-my-pi/index.js`.
- Updated the root build command to compile `src/hosts/oh-my-pi/index.ts` into `dist/hosts/oh-my-pi/index.js`.
- Linked the repo into the installed Oh My Pi extension root as `/home/supreme/.omp/agent/extensions/oh-my-openagent-dev` for the focused loader probe.

Why:

- Chunk 4 needed native Oh My Pi discovery/load proof before porting real tools, commands, resources, and hooks.
- The diagnostic surface is temporary wiring proof and is not counted as full feature support.

Files touched:

- `package.json`
- `src/hosts/oh-my-pi/index.ts`
- `src/hosts/oh-my-pi/extension-api.ts`
- `src/hosts/oh-my-pi/manifest.ts`
- `src/hosts/oh-my-pi/register-diagnostics.ts`
- `src/hosts/oh-my-pi/register-diagnostics.test.ts`
- `docs/porting/oh-my-openagent-full-omp-pi-port.md`
- `docs/porting/CONTEXT.md`

Checks run:

- `bun test src/hosts/oh-my-pi/register-diagnostics.test.ts` passed: 1 test, 4 assertions.
- `bun run build` passed and emitted `dist/hosts/oh-my-pi/index.js`.
- `bun run typecheck` passed.
- `test -f dist/hosts/oh-my-pi/index.js && echo dist-oh-my-pi-adapter-present` confirmed the built entrypoint exists.
- `which omp && readlink -f $(which omp)` resolved:
  - `/home/supreme/.bun/bin/omp`
  - `/home/supreme/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts`
- `rg -n "\bany\b|@ts-ignore|@ts-expect-error|[\u2013\u2014]|utils\.ts|helpers\.ts|service\.ts" src/hosts/oh-my-pi src/host-runtime src/host-contract` returned no matches.

Installed runtime probe notes:

- Created symlink:
  - `/home/supreme/.omp/agent/extensions/oh-my-openagent-dev` -> `/home/supreme/oh-my-openagent`
- Probe command used the installed Oh My Pi loader:

```bash
bun -e 'import { discoverAndLoadExtensions } from "/home/supreme/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/loader.ts";
const extensionPath = "/home/supreme/.omp/agent/extensions/oh-my-openagent-dev";
const result = await discoverAndLoadExtensions([extensionPath], process.cwd());
const loaded = result.extensions.map((extension) => ({ path: extension.path, label: extension.label, commands: [...extension.commands.keys()], tools: [...extension.tools.keys()] }));
console.log(JSON.stringify({ errors: result.errors, loaded }, null, 2));'
```

- Probe result summary:
  - `errors: []`
  - loaded `/home/supreme/.omp/agent/extensions/oh-my-openagent-dev/dist/hosts/oh-my-pi/index.js`
  - label: `Oh My OpenAgent`
  - command: `omo-diagnostic`
  - tool: `omo_diagnostic`
- Other existing global Oh My Pi extensions also loaded during the probe: `harness-helper` and `iteration-runner`.

Review findings:

- No Oh My Pi source repo files were patched.
- No installed runtime files were patched.
- The installed extension root was only linked to the current source repo for a loader probe.
- OpenCode behavior remains untouched except the root build command now has a second entrypoint.
- The root package manifest now has `omp.extensions`; `pi.extensions` remains for Chunk 5.
- The diagnostic command/tool are temporary loader-proof surfaces.

Blockers:

- None.

Next:

- Start Chunk 5: Add Pi adapter entrypoint skeleton.

### Chunk 5: Add Pi adapter entrypoint skeleton

Status: Complete.

What happened:

- Inspected the existing installed partial Pi bridge at `/home/supreme/.pi/agent/extensions/oh-my-pi.ts`.
- Confirmed the existing partial bridge is a large standalone OMP-to-Pi hook bridge and left it untouched.
- Added a native Pi adapter skeleton under `src/hosts/pi/`.
- Kept the adapter diagnostic-only.
- Added structural local Pi API types so Oh My OpenAgent does not need a compile-time dependency on `@earendil-works/pi-coding-agent` or `@mariozechner/pi-coding-agent`.
- Added constants for the Pi extension entry, label, command, and tool.
- Added `registerPiDiagnostics()` to register:
  - command `omo-pi-diagnostic`
  - tool `omo_pi_diagnostic`
- Added a focused unit test proving the skeleton registers those diagnostic surfaces.
- Added root `package.json` `pi.extensions` pointing at `./dist/hosts/pi/index.js`.
- Updated the root build command to compile `src/hosts/pi/index.ts` into `dist/hosts/pi/index.js`.
- Linked the repo into the installed Pi extension root as `/home/supreme/.pi/agent/extensions/oh-my-openagent-dev` for the focused loader probe.

Why:

- Chunk 5 needed native Pi discovery/load proof before real feature surfaces are ported.
- Separate diagnostic names avoid collisions with the existing partial bridge.
- The existing partial bridge remains a migration concern for the packaging/install chunk.

Files touched:

- `package.json`
- `src/hosts/pi/index.ts`
- `src/hosts/pi/extension-api.ts`
- `src/hosts/pi/manifest.ts`
- `src/hosts/pi/register-diagnostics.ts`
- `src/hosts/pi/register-diagnostics.test.ts`
- `docs/porting/oh-my-openagent-full-omp-pi-port.md`
- `docs/porting/CONTEXT.md`

Checks run:

- `sed -n '1,220p' /home/supreme/.pi/agent/extensions/oh-my-pi.ts` inspected the existing partial bridge.
- `ls -la /home/supreme/.pi/agent/extensions` confirmed existing installed Pi extensions.
- `which pi && readlink -f $(which pi)` resolved:
  - `/home/supreme/.bun/bin/pi`
  - `/home/supreme/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`
- `bun test src/hosts/pi/register-diagnostics.test.ts` passed: 1 test, 3 assertions.
- `bun run build` passed and emitted `dist/hosts/pi/index.js`.
- `bun run typecheck` passed.
- `test -f dist/hosts/pi/index.js && echo dist-pi-adapter-present` confirmed the built entrypoint exists.
- `rg -n "\bany\b|@ts-ignore|@ts-expect-error|[\u2013\u2014]|utils\.ts|helpers\.ts|service\.ts" src/hosts/pi src/hosts/oh-my-pi src/host-runtime src/host-contract` returned no matches.

Installed runtime probe notes:

- Created symlink:
  - `/home/supreme/.pi/agent/extensions/oh-my-openagent-dev` -> `/home/supreme/oh-my-openagent`
- Probe command used the installed Pi loader:

```bash
bun -e 'import { discoverAndLoadExtensions } from "/home/supreme/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
const extensionPath = "/home/supreme/.pi/agent/extensions/oh-my-openagent-dev";
const result = await discoverAndLoadExtensions([extensionPath], process.cwd(), "/home/supreme/.pi/agent");
const loaded = result.extensions.map((extension) => ({ path: extension.path, commands: [...extension.commands.keys()], tools: [...extension.tools.keys()] }));
console.log(JSON.stringify({ errors: result.errors, loaded }, null, 2));'
```

- Probe result summary:
  - `errors: []`
  - loaded `/home/supreme/.pi/agent/extensions/oh-my-openagent-dev/dist/hosts/pi/index.js`
  - command: `omo-pi-diagnostic`
  - tool: `omo_pi_diagnostic`
- Other existing global Pi extensions also loaded during the probe:
  - `zenmux.ts`
  - `iteration-runner.ts`
  - `oh-my-pi.ts`, which printed `[oh-my-pi] Extension loaded: 15 hooks registered`

Review findings:

- No Pi source repo files were patched.
- No installed runtime files were patched.
- The installed extension root was only linked to the current source repo for a loader probe.
- The existing partial `/home/supreme/.pi/agent/extensions/oh-my-pi.ts` remains in place and loaded during the probe.
- OpenCode behavior remains untouched except the root build command now has target adapter entrypoints.
- The root package manifest now has both `omp.extensions` and `pi.extensions`.
- The diagnostic command/tool are temporary loader-proof surfaces.

Blockers:

- None.

Next:

- Start Chunk 6: Normalize tool registration and schemas.

### Chunk 6: Normalize tool registration and schemas

Status: Complete.

What happened:

- Added `src/host-tools/` with shared schema, result, and target registration normalization.
- Added `createOpenCodeToolParameterSchema()` to turn OpenCode tool args into a target JSON schema while preserving required and optional fields.
- Added `sanitizeJsonSchema()` and `stripRootJsonSchemaFields()` to a shared location.
- Updated `src/plugin/normalize-tool-arg-schemas.ts` to reuse the shared sanitizer while preserving its existing OpenCode JSON schema override behavior.
- Added `normalizeOpenCodeToolResult()` for string and structured OpenCode tool results.
- Added `createHostToolErrorResult()` and `toTargetToolResult()` for target-compatible content/error shape.
- Added `createTargetToolDefinition()` and `registerTargetTool()` to wrap normalized host tools for Oh My Pi and Pi style registration.
- Added focused tests for schema conversion, schema sanitization, result conversion, target registration, and target execution error conversion.

Why:

- Chunk 7 needs a proven bridge before always-on tools are registered into Oh My Pi and Pi.
- OpenCode tool definitions must keep their current names and behavior.
- Pi-family adapters need a stable parameters/result shape before real tools are wired into their native `registerTool` APIs.

Files touched:

- `src/host-tools/index.ts`
- `src/host-tools/tool-schema.ts`
- `src/host-tools/tool-result.ts`
- `src/host-tools/tool-registration.ts`
- `src/host-tools/tool-normalization.test.ts`
- `src/plugin/normalize-tool-arg-schemas.ts`
- `docs/porting/oh-my-openagent-full-omp-pi-port.md`
- `docs/porting/CONTEXT.md`

Checks run:

- `bun test src/host-tools/tool-normalization.test.ts src/plugin/normalize-tool-arg-schemas.test.ts` passed: 9 tests, 28 assertions.
- `bun run typecheck` passed.
- `rg -n "\bany\b|@ts-ignore|@ts-expect-error|[\u2013\u2014]|utils\.ts|helpers\.ts|service\.ts" src/host-tools src/plugin/normalize-tool-arg-schemas.ts` returned no matches.
- `git status --short` showed tracked changes in `package.json` and `src/plugin/normalize-tool-arg-schemas.ts`, plus untracked porting docs and new host directories.

Review findings:

- No target runtime files were patched.
- No target source repos were patched.
- No OpenCode tool names changed.
- Existing OpenCode `normalizeToolArgSchemas()` still mutates per-arg schema objects for host Zod compatibility.
- Target registration wrappers are not yet wired into the Oh My Pi or Pi adapters; Chunk 7 owns that.

Blockers:

- None.

Installed runtime probe notes:

- None. Chunk 6 was source normalization work only.

Next:

- Start Chunk 7: Port always-on utility tools.

### Chunk 7: Port always-on utility tools

Status: Complete.

What happened:

- Added `src/host-tools/always-on-tools.ts`.
- Added `src/host-tools/always-on-tools.test.ts`.
- Exported the always-on tool registration helpers from `src/host-tools/index.ts`.
- Extended `src/host-tools/tool-registration.ts` with `createHostToolFromOpenCodeTool()` and a minimal OpenCode tool context wrapper for target-host execution.
- Registered the first always-on utility tools in both target adapters:
  - `grep`
  - `glob`
  - `session_list`
  - `session_read`
  - `session_search`
  - `session_info`
  - `background_output`
  - `background_cancel`
  - `skill`
- Wired Oh My Pi and Pi adapters through `registerAlwaysOnUtilityTools()` after diagnostic registration.
- Updated local Oh My Pi and Pi extension API types to accept structured `HostToolContent[]` results plus optional `isError`.
- Kept OpenCode tool names unchanged.

Why:

- This chunk moves from diagnostic-only target adapters to real utility tool exposure.
- Existing OpenCode-backed tool factories can be reused for grep, glob, session tools, and skill once their tool definitions are wrapped in the shared host-tool layer.
- Background output/cancel need real target-native background task state later, so this chunk registers the names with explicit unavailable results instead of pretending behavior is complete.

Files touched:

- `src/host-tools/index.ts`
- `src/host-tools/tool-registration.ts`
- `src/host-tools/always-on-tools.ts`
- `src/host-tools/always-on-tools.test.ts`
- `src/hosts/oh-my-pi/extension-api.ts`
- `src/hosts/oh-my-pi/index.ts`
- `src/hosts/pi/extension-api.ts`
- `src/hosts/pi/index.ts`
- `docs/porting/oh-my-openagent-full-omp-pi-port.md`
- `docs/porting/CONTEXT.md`

Checks run:

- `bun test src/host-tools/always-on-tools.test.ts src/host-tools/tool-normalization.test.ts src/hosts/oh-my-pi/register-diagnostics.test.ts src/hosts/pi/register-diagnostics.test.ts` passed: 13 tests, 31 assertions.
- `bun test src/host-tools/always-on-tools.test.ts src/host-tools/tool-normalization.test.ts && bun run typecheck` passed: 11 tests, 24 assertions, then full typecheck passed.
- `bun run build` passed and emitted:
  - `dist/index.js`
  - `dist/hosts/oh-my-pi/index.js`
  - `dist/hosts/pi/index.js`
- Installed Oh My Pi loader probe loaded `/home/supreme/.omp/agent/extensions/oh-my-openagent-dev/dist/hosts/oh-my-pi/index.js` with no errors.
- Installed Oh My Pi loader probe found command `omo-diagnostic` and tools:
  - `background_cancel`
  - `background_output`
  - `glob`
  - `grep`
  - `omo_diagnostic`
  - `session_info`
  - `session_list`
  - `session_read`
  - `session_search`
  - `skill`
- Installed Pi loader probe loaded `/home/supreme/.pi/agent/extensions/oh-my-openagent-dev/dist/hosts/pi/index.js` with no errors.
- Installed Pi loader probe found command `omo-pi-diagnostic` and tools:
  - `background_cancel`
  - `background_output`
  - `glob`
  - `grep`
  - `omo_pi_diagnostic`
  - `session_info`
  - `session_list`
  - `session_read`
  - `session_search`
  - `skill`
- `rg -n "\bany\b|@ts-ignore|@ts-expect-error|[\u2013\u2014]|utils\.ts|helpers\.ts|service\.ts" src/host-tools src/hosts src/host-runtime src/host-contract src/plugin/normalize-tool-arg-schemas.ts` returned no matches.

Review findings:

- No target source repo files were patched.
- No installed runtime files were patched.
- Existing installed symlinks remain:
  - `/home/supreme/.omp/agent/extensions/oh-my-openagent-dev` -> `/home/supreme/oh-my-openagent`
  - `/home/supreme/.pi/agent/extensions/oh-my-openagent-dev` -> `/home/supreme/oh-my-openagent`
- The existing partial Pi bridge at `/home/supreme/.pi/agent/extensions/oh-my-pi.ts` remains in place and loaded during the Pi probe.
- `background_output` and `background_cancel` are registered but intentionally return target-unavailable errors until Chunk 22 ports background manager and continuation dispatch.
- The minimal OpenCode tool context uses file-backed session tooling and does not store an OpenCode SDK client for target adapters.

Blockers:

- None.

Installed runtime probe notes:

- Both target installed loaders can discover the dev extension and see all Chunk 7 utility tool names.
- The Pi probe still prints `[oh-my-pi] Extension loaded: 15 hooks registered` from the unrelated existing partial bridge.

Next:

- Start Chunk 8: Port MCP-backed LSP and AST tool exposure.

### Chunk 8: Port MCP-backed LSP and AST tool exposure

Status: Complete.

What happened:

- Added `src/host-tools/mcp-backed-tools.ts`.
- Added `src/host-tools/mcp-backed-tools.test.ts`.
- Exported MCP-backed target registration helpers from `src/host-tools/index.ts`.
- Registered these public OMO tool names in both target adapters:
  - `lsp_goto_definition`
  - `lsp_find_references`
  - `lsp_symbols`
  - `lsp_diagnostics`
  - `lsp_prepare_rename`
  - `lsp_rename`
  - `ast_grep_search`
  - `ast_grep_replace`
- Preserved public names directly, so target users do not need `mcp__lsp_*` or `mcp__ast_grep_*` names.
- Added `mcpServerName` and `mcpToolName` metadata to target tool definitions.
- Implemented a vendored MCP backend that resolves the existing local MCP command configs and calls the servers over JSON-RPC stdio.
- Fixed the Bun subprocess stdin path for these calls by writing the JSON request and then closing stdin.
- Wired Oh My Pi and Pi adapters through `registerMcpBackedTools()` after always-on utility registration.

Why:

- OpenCode now gets LSP and AST-grep through built-in MCP servers, but the target extension APIs do not expose a clean direct seam for extensions to inject MCP server configs into the active MCP manager.
- Oh My Pi has a native MCP manager, but the extension API currently exposes tool registration, not MCP server registration plus session refresh.
- Pi does not expose an equivalent MCP manager in the current source.
- Native target tools backed by the vendored MCP protocol preserve the public OMO tool names and real MCP behavior without mutating target runtime internals.

Files touched:

- `src/host-tools/index.ts`
- `src/host-tools/mcp-backed-tools.ts`
- `src/host-tools/mcp-backed-tools.test.ts`
- `src/hosts/oh-my-pi/index.ts`
- `src/hosts/pi/index.ts`
- `docs/porting/oh-my-openagent-full-omp-pi-port.md`
- `docs/porting/CONTEXT.md`

Checks run:

- `bun test src/host-tools/mcp-backed-tools.test.ts src/host-tools/always-on-tools.test.ts && bun run typecheck` passed: 9 tests, 20 assertions, then full typecheck passed.
- Focused LSP flow: `lsp_diagnostics` executed through the vendored LSP MCP subprocess and returned a target-shaped text result.
- Focused AST flow: `ast_grep_search` executed through the vendored AST-grep MCP subprocess and returned a match from a temporary TypeScript file.
- `bun run build` passed and emitted:
  - `dist/index.js`
  - `dist/hosts/oh-my-pi/index.js`
  - `dist/hosts/pi/index.js`
  - regenerated `assets/oh-my-opencode.schema.json`
- Installed Oh My Pi loader probe loaded `/home/supreme/.omp/agent/extensions/oh-my-openagent-dev/dist/hosts/oh-my-pi/index.js` with no errors.
- Installed Oh My Pi loader probe found all Chunk 8 public tool names:
  - `ast_grep_replace`
  - `ast_grep_search`
  - `lsp_diagnostics`
  - `lsp_find_references`
  - `lsp_goto_definition`
  - `lsp_prepare_rename`
  - `lsp_rename`
  - `lsp_symbols`
- Installed Pi loader probe loaded `/home/supreme/.pi/agent/extensions/oh-my-openagent-dev/dist/hosts/pi/index.js` with no errors.
- Installed Pi loader probe found all Chunk 8 public tool names:
  - `ast_grep_replace`
  - `ast_grep_search`
  - `lsp_diagnostics`
  - `lsp_find_references`
  - `lsp_goto_definition`
  - `lsp_prepare_rename`
  - `lsp_rename`
  - `lsp_symbols`

Review findings:

- No target source repo files were patched.
- No installed runtime files were patched.
- No target MCP namespace mapping is required for Chunk 8 because public names are registered directly as extension tools.
- Target-native MCP manager injection remains a possible future target seam, but it is not required for these public tools to execute.
- The existing partial Pi bridge at `/home/supreme/.pi/agent/extensions/oh-my-pi.ts` remains in place and loaded during the Pi probe.

Blockers:

- None.

Installed runtime probe notes:

- Both target installed loaders can discover the dev extension and see all Chunk 8 MCP-backed tool names.
- The Pi probe still prints `[oh-my-pi] Extension loaded: 15 hooks registered` from the unrelated existing partial bridge.

Next:

- Start Chunk 9: Port hashline edit.

### Chunk 9: Port hashline edit

Status: Complete.

What happened:

- Added `src/host-tools/hashline-edit-tool.ts`.
- Added `src/host-tools/hashline-edit-tool.test.ts`.
- Exported the hashline edit registration helper from `src/host-tools/index.ts`.
- Registered the public `edit` tool in both target adapters.
- Reused the existing `createHashlineEditTool()` implementation through the host-tool wrapper.
- Marked hashline `Error:` text results as target `isError: true`.
- Preserved immediate apply behavior. Target pending actions and deferrable edit staging are not used because the OpenCode hashline tool applies immediately.
- Wired Oh My Pi and Pi adapters through `registerHashlineEditTool()` after MCP-backed tool registration.

Why:

- Hashline safety lives in the existing shared implementation and hashline-core package.
- Reusing the existing tool keeps stale-anchor validation, mismatch context, edit normalization, delete, and rename behavior aligned with OpenCode.
- Target deferrable support exists in Oh My Pi, but using it here would change the current product behavior. Immediate apply is the correct parity behavior for this chunk.

Files touched:

- `src/host-tools/index.ts`
- `src/host-tools/hashline-edit-tool.ts`
- `src/host-tools/hashline-edit-tool.test.ts`
- `src/hosts/oh-my-pi/index.ts`
- `src/hosts/pi/index.ts`
- `docs/porting/oh-my-openagent-full-omp-pi-port.md`
- `docs/porting/CONTEXT.md`

Checks run:

- `bun test src/host-tools/hashline-edit-tool.test.ts src/host-tools/mcp-backed-tools.test.ts src/host-tools/always-on-tools.test.ts && bun run typecheck` passed: 12 tests, 30 assertions, then full typecheck passed.
- Focused target valid edit test proved a correct `LINE#ID` replacement updates the file.
- Focused target stale edit test proved a stale hash returns `isError: true`, includes mismatch context, and leaves the file unchanged.
- `bun run build` passed and emitted:
  - `dist/index.js`
  - `dist/hosts/oh-my-pi/index.js`
  - `dist/hosts/pi/index.js`
  - regenerated `assets/oh-my-opencode.schema.json`
- Installed Oh My Pi loader probe loaded `/home/supreme/.omp/agent/extensions/oh-my-openagent-dev/dist/hosts/oh-my-pi/index.js` with no errors and found `edit`.
- Installed Pi loader probe loaded `/home/supreme/.pi/agent/extensions/oh-my-openagent-dev/dist/hosts/pi/index.js` with no errors and found `edit`.

Review findings:

- No target source repo files were patched.
- No installed runtime files were patched.
- No OpenCode hashline behavior was changed.
- Target pending actions are not used for hashline edit because the source tool applies immediately.
- The existing partial Pi bridge at `/home/supreme/.pi/agent/extensions/oh-my-pi.ts` remains in place and loaded during the Pi probe.

Blockers:

- None.

Installed runtime probe notes:

- Both target installed loaders can discover the dev extension and see `edit` alongside Chunk 7 and Chunk 8 tools.
- The Pi probe still prints `[oh-my-pi] Extension loaded: 15 hooks registered` from the unrelated existing partial bridge.

Next:

- Start Chunk 10: Port look-at and interactive bash.

### Chunk 10: Port look-at and interactive bash

Status: Complete.

What happened:

- Added `src/host-tools/gated-runtime-tools.ts`.
- Added `src/host-tools/gated-runtime-tools.test.ts`.
- Registered `interactive_bash` in both target adapters only when tmux exists.
- Reused the existing interactive bash command tokenizer, command restrictions, subprocess execution, timeout, and error behavior.
- Proved a scoped tmux session create/list/kill lifecycle and cleanup.
- Proved `kill-server` remains prohibited.
- Added target `look_at` support by reusing source input preparation and running target print mode with an `@file` attachment.

Files touched:

- `src/host-tools/gated-runtime-tools.ts`
- `src/host-tools/gated-runtime-tools.test.ts`
- `src/host-tools/index.ts`
- `src/hosts/oh-my-pi/index.ts`
- `src/hosts/pi/index.ts`
- `docs/porting/oh-my-openagent-full-omp-pi-port.md`
- `docs/porting/CONTEXT.md`

Checks run:

- `bun test src/host-tools/gated-runtime-tools.test.ts && bun run typecheck` passed: 5 tests, 9 assertions, then full typecheck passed.

Review findings:

- No target source repo or installed runtime files were patched.
- `interactive_bash` is registered only when tmux is present.
- `look_at` is registered for target adapters and returns target multimodal CLI output.

Blockers:

- None for gated runtime tools.

Next:

- Start Chunk 11: Port task and delegation tools.

### Chunk 11: Port task and delegation tools

Status: Complete.

What happened:

- Added `src/host-tools/task-tools.ts`.
- Added `src/host-tools/task-tools.test.ts`.
- Registered `task`, `call_omo_agent`, `task_create`, `task_get`, `task_list`, and `task_update` in both target adapters.
- Ported task CRUD to target-local `.omo/tasks` storage.
- Registered delegation surfaces with explicit missing child-session seam results.

Checks run:

- `bun test src/host-tools/task-tools.test.ts && bun run typecheck` passed: 3 tests, 6 assertions, then full typecheck passed.

Review findings:

- Task CRUD is functional and independent of the OpenCode SDK.
- Delegation cannot honestly execute until the target extension APIs expose named child session spawn, prompt dispatch, wait, and response collection.

Blockers:

- `task` and `call_omo_agent` delegation execution require a target-native child agent session seam.

Next:

- Start Chunk 12: Port named agents and categories.

### Chunks 12-15: Agents, commands, resources, and Oh My Pi resource seam

Status: Complete.

What happened:

- Added `src/host-agents/` with the canonical 11-agent inventory, category inventory, route resolution, subprocess-isolated target runner, and focused routing tests.
- Preserved canonical core order, read-only policies, Prometheus restriction metadata, and Team Mode eligibility.
- Replaced `task` and `call_omo_agent` missing-seam placeholders with real named-agent and category routes through `omp` or `pi` subprocesses.
- Added `src/host-resources/` command registration and resource discovery.
- Registered all builtin OMO commands plus canonical `.agents/command` files with `.opencode/command` compatibility.
- Registered target `resources_discover` handlers for canonical, legacy, and packaged shared skill roots.
- Patched `/home/supreme/pr-work/oh-my-pi/packages/coding-agent/src/sdk.ts` to invoke `resources_discover` and merge extension skills and prompt templates.
- Exported Oh My Pi's existing prompt-directory loader for the generic extension resource seam.
- Added an Oh My Pi SDK regression test proving an extension-provided skill and prompt are visible on the session.

Checks run:

- `bun test src/host-agents/agent-routing.test.ts src/host-tools/task-tools.test.ts` passed: 6 tests, 18 assertions.
- `bun test src/host-resources/command-registration.test.ts src/hosts/pi/register-diagnostics.test.ts src/hosts/oh-my-pi/register-diagnostics.test.ts` passed.
- `bun test src/host-resources/*.test.ts src/hosts/pi/register-diagnostics.test.ts src/hosts/oh-my-pi/register-diagnostics.test.ts` passed.
- Root `bun run typecheck` passed after each source group.
- Oh My Pi `bun check` passed.
- Oh My Pi focused SDK test initially could not start because the local `pi_natives` addon was absent. A local native build was started so the focused SDK test can be rerun.

Review findings:

- Agent execution now has an isolated-process seam supported by both target CLIs.
- Prometheus is stricter on targets than OpenCode: its target subprocess receives read-only tools, preventing writes outside `.omo/*.md` while the targets lack a path-scoped write permission API.
- Oh My Pi needed a durable source patch because its declared `resources_discover` event had no session callsite.
- Pi already wires the event and required no source patch.

Blockers:

- None for Chunks 12-15. The Oh My Pi focused runtime test remains to be rerun after the native addon build finishes.

Next:

- Start Chunk 16: Port hook event normalization.

### Chunks 16-19: Hooks, guards, transforms, and provider fallback

Status: Complete.

What happened:

- Added `src/host-hooks/` event normalization with explicit mappings for all five OpenCode hook tiers.
- Added target-native tool guards for simple bash file reads and writes to unread existing files.
- Ran the existing comment checker after successful target write, edit, and apply-patch results.
- Added target input and system transforms for `ultrawork`, `search`, `analyze`, and explicit `team mode` routes.
- Added non-mutating target message validation for thinking blocks and tool call/result pairs.
- Added provider request mutation, response error observation, fallback model selection, and one-shot failed-turn replay using the source Sisyphus fallback chain.

Files touched:

- `src/host-hooks/event-map.ts`
- `src/host-hooks/hook-dispatch.ts`
- `src/host-hooks/hook-registration.ts`
- `src/host-hooks/tool-guards.ts`
- `src/host-hooks/message-transforms.ts`
- `src/host-hooks/provider-fallback.ts`
- focused tests beside those files
- both target adapter entrypoints and extension API types
- `docs/porting/oh-my-openagent-full-omp-pi-port.md`
- `docs/porting/CONTEXT.md`

Checks run:

- Focused hook and adapter tests passed: 13 tests, 27 assertions.
- Root `bun run typecheck` passed.

Review findings:

- Target provider request and response events are richer than the OpenCode adapter surface and support direct observation.
- Target model fallback switches model through `setModel` and replays the failed user prompt once through `sendUserMessage(..., { deliverAs: "followUp" })`.
- Pi lacks `session.compacting`; Oh My Pi exposes it.

Blockers:

- None for Chunks 16-19.

Next:

- Start Chunk 20: Port MCP tier 1 and Claude MCP config.

### Chunks 20-25: MCP, continuation, Team Mode, OpenClaw, and packaging

Status: Complete.

What happened:

- Added target MCP inventory merging built-ins and Claude `.mcp.json` layers with environment allowlist behavior.
- Registered `mcp_servers` and `skill_mcp` in both adapters.
- Reused `SkillMcpManager` for per-session stdio/HTTP/OAuth behavior.
- Added a target prompt gate, compaction continuation, and background-completion wake coalescing.
- Added all 12 Team Mode tools behind `OMO_TEAM_MODE=1`, preserving eligibility and durable source runtime state.
- Added target OpenClaw session dispatch and reused the existing inbound reply listener/tmux path.
- Added `install-targets` CLI support for non-clobbering links into both target extension roots.

Checks run:

- Focused target hook, MCP, Team Mode, OpenClaw, and installer tests passed after fixing test setup.
- Root typecheck is included in the Chunk 26 source regression pass.

Review findings:

- Target Team Mode now creates source-style runtime state under `.omo/target-team-mode`, member inboxes, task storage, worktree directories, and automatic tmux panes when tmux is available.
- Target skill MCP uses a stable process session key by default and preserves distinct keys when the target supplies distinct session identity.
- The existing partial Pi bridge remains untouched until installed-runtime dogfood confirms replacement.

Blockers:

- None for source implementation.

Next:

- Start Chunk 26: Source-level regression checks.

### Chunk 26: Source-level regression checks

Status: Complete.

What happened:

- Fixed the target local MCP caller to use `src/shared/bun-spawn-shim.ts` instead of raw `Bun.spawn`, preserving the existing dist bundle Node-import invariant.
- Built the vendored LSP MCP and LSP daemon runtime dists before installer tests because Codex installer tests copy those bundled dists.
- Re-ran the full root test suite after the build and shim fix.
- Reran Oh My Pi source checks after the durable source patches.

Files touched:

- `src/host-tools/mcp-backed-tools.ts`
- `docs/porting/oh-my-openagent-full-omp-pi-port.md`
- `docs/porting/CONTEXT.md`

Checks run:

- `bun test src/host-contract src/host-runtime src/host-tools src/host-agents src/host-resources src/host-hooks src/host-mcp src/hosts src/cli/install-targets` passed: 65 tests, 144 assertions.
- `bun run build:lsp-tools-mcp && bun run build:lsp-daemon && bun run typecheck && bun run build` passed.
- `bun test src/shared/dist-bundle-bun-globals.test.ts src/cli/install-codex/install-codex-git-bash-preflight.test.ts src/cli/install-codex/install-codex-mcp-manifest.test.ts src/cli/install-codex/install-codex.test.ts` passed after building bundled LSP dists.
- Full root `bun test` passed: 8687 pass, 1 skip, 0 fail, 22 snapshots, 20376 assertions across 994 files.
- Oh My Pi `bun test packages/coding-agent/test/sdk-skills.test.ts && bun check` passed.

Review findings:

- The first full root test run exposed two real test-environment/source issues: a raw `Bun.spawn` in the newly bundled target MCP path, and missing `packages/lsp-daemon/dist` for installer tests. Both were fixed by source update and required prebuilds.
- Pi source repo had no changes.
- Oh My Pi source checks are green with the resource-discovery and symlink-discovery patches.

Blockers:

- None.

Next:

- Start Chunk 27: Installed-runtime dogfood for Oh My Pi.

### Chunk 27: Installed-runtime dogfood for Oh My Pi

Status: Complete.

What happened:

- Verified `/home/supreme/.omp/agent/extensions/oh-my-openagent-dev` points at `/home/supreme/oh-my-openagent`.
- Confirmed native Oh My Pi discovery now finds `oh-my-openagent-dev/dist/hosts/oh-my-pi/index.js` with no explicit configured path.
- Ran installed-runtime dogfood through `/home/supreme/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/loader.ts`.

Installed runtime evidence:

```json
{
  "errors": [],
  "toolCount": 41,
  "hasLookAt": true,
  "teamTools": 12,
  "diag": "Oh My OpenAgent Oh My Pi adapter loaded.",
  "mcpHasLsp": true,
  "taskCreated": true,
  "inputMarker": true,
  "skillPaths": 3,
  "teamStatus": "active",
  "worktreesExist": true,
  "tmuxPanes": 2,
  "tmuxSessionLive": true
}
```

Review findings:

- Oh My Pi now loads OMO through native extension discovery from the `.omp` extension root.
- The dogfood exercised diagnostic tool, MCP inventory, task create, resource discovery, `look_at` registration, Team Mode source runtime state, worktree creation, and live target tmux layout activation.
- Command registration and agent routing are covered by source tests; installed dogfood did not launch a live LLM-backed delegated subagent to avoid spending provider credentials.

Blockers:

- `look_at` is implemented for target adapters through target print-mode multimodal attachment handling.
- Team Mode target tools preserve source runtime state and automatically create worktree directories plus tmux layout metadata when tmux is available.

Next:

- Start Chunk 28: Installed-runtime dogfood for Pi.

### Chunk 28: Installed-runtime dogfood for Pi

Status: Complete.

What happened:

- Verified `/home/supreme/.pi/agent/extensions/oh-my-openagent-dev` points at `/home/supreme/oh-my-openagent`.
- Confirmed installed Pi native discovery loads the `pi.extensions` adapter from the package root.
- Ran installed-runtime dogfood through `/home/supreme/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js`.

Installed runtime evidence:

```json
{
  "errors": [],
  "toolCount": 41,
  "hasLookAt": true,
  "teamTools": 12,
  "diag": "Oh My OpenAgent Pi adapter loaded.",
  "mcpHasLsp": true,
  "taskCreated": true,
  "inputMarker": true,
  "skillPaths": 3,
  "teamStatus": "active",
  "worktreesExist": true,
  "tmuxPanes": 2,
  "tmuxSessionLive": true
}
```

Review findings:

- Pi loads OMO through native extension discovery from the `.pi` extension root.
- The existing partial Pi bridge at `/home/supreme/.pi/agent/extensions/oh-my-pi.ts` remains untouched. The full port can coexist for dogfood; cleanup should be explicit later.
- The dogfood exercised diagnostic tool, MCP inventory, task create, resource discovery, `look_at` registration, Team Mode source runtime state, worktree creation, and live target tmux layout activation.

Blockers:

- Same target behavior as Oh My Pi: `look_at` is registered through target print-mode multimodal attachment handling, and Team Mode creates source-style runtime state, worktrees, and tmux layout metadata.

Next:

- Start Chunk 29: Final review and release readiness.

### Chunk 29: Final review and release readiness

Status: Complete.

What happened:

- Updated the PRD top status and final feature status table.
- Recorded final dogfood evidence here.
- Re-ran final audits after documentation updates.

Final verification summary:

- Root full suite: `bun test` passed with 8687 pass, 1 skip, 0 fail.
- Root build and typecheck: `bun run build:lsp-tools-mcp && bun run build:lsp-daemon && bun run typecheck && bun run build` passed.
- Target source suite: `bun test src/host-contract src/host-runtime src/host-tools src/host-agents src/host-resources src/host-hooks src/host-mcp src/hosts src/cli/install-targets` passed.
- Oh My Pi source: `bun test packages/coding-agent/test/sdk-skills.test.ts && bun check` passed.
- Installed Oh My Pi dogfood: passed with native discovery, 41 tools, `look_at`, 12 Team Mode tools, MCP inventory, task creation, resource discovery, worktree creation, and live target tmux layout activation.
- Installed Pi dogfood: passed with native discovery, 41 tools, `look_at`, 12 Team Mode tools, MCP inventory, task creation, resource discovery, worktree creation, and live target tmux layout activation.

Final limitations:

- `look_at` is registered for both target adapters and tested for file and base64 image inputs.
- Target Team Mode registers and tests the full tool lifecycle, source runtime state, worktree directories, and automatic tmux layout metadata.
- Target runtime fallback selects a fallback model and replays the failed prompt once after retryable provider failures.
- Skill MCP OAuth has a local live-flow test covering protected-resource discovery, authorization-server discovery, DCR, PKCE callback, token exchange, and token storage.

Blockers:

- None for the completed port certification.

Next:

- Ready for human review or PR preparation.

### 2026-06-11 Target Parity Closure Addendum

Status: Complete.

What changed after the original final review:

- Target `look_at` is now implemented through target print-mode multimodal attachment handling.
- Target Team Mode now creates source-style runtime state, inboxes, worktree directories, and tmux layout metadata, and installed dogfood proved live target tmux sessions when tmux is available.
- Target runtime fallback now extracts the failed user prompt from provider payloads, selects the next source fallback model, and replays the failed turn once through the target message API.
- Skill MCP OAuth now has a local live-flow test covering protected-resource discovery, authorization-server discovery, DCR, PKCE callback, token exchange, and token storage.

Verification rerun:

- `timeout 180s bun test src/host-tools/gated-runtime-tools.test.ts src/host-tools/look-at-tool.test.ts src/host-hooks/provider-fallback.test.ts src/host-tools/team-tools.test.ts src/features/mcp-oauth/provider-live-local.test.ts src/features/mcp-oauth/provider.test.ts src/features/mcp-oauth/discovery.test.ts` passed with 33 tests and 88 assertions.
- `timeout 240s bun run typecheck` passed.
- `bun run build` passed and emitted fresh target adapter entrypoints.
- Installed Oh My Pi dogfood through `/home/supreme/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/loader.ts` loaded `/home/supreme/.omp/agent/extensions/oh-my-openagent-dev/dist/hosts/oh-my-pi/index.js` with zero loader errors, 41 tools, `look_at` present, 12 Team Mode tools, MCP inventory including `lsp`, successful task creation, target skill roots, active Team Mode state, two worktree directories, a live target tmux session, and two tmux panes.
- Installed Pi dogfood through `/home/supreme/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js` loaded `/home/supreme/.pi/agent/extensions/oh-my-openagent-dev/dist/hosts/pi/index.js` with zero loader errors, 41 tools, `look_at` present, 12 Team Mode tools, MCP inventory including `lsp`, successful task creation, target skill roots, active Team Mode state, two worktree directories, a live target tmux session, and two tmux panes.
- Both dogfood probes ran from temporary working directories and killed the target tmux sessions before exit.

Verification note:

- Final `bun test` was attempted after the OAuth callback-port fix. It progressed through thousands of tests with no surfaced failure, then stopped producing output and sat in a kernel wait state for about 10 minutes. The process was killed to avoid carrying a silent hung full-suite run. The changed areas are covered by the bounded focused suites above.

### 2026-06-11 NEW-GOAL Targeted Certification Update

User constraint:

- After the full-suite attempt consumed too many resources, the user explicitly requested no more full root `bun test` runs and asked for specific targeted tests instead.

Fixes made during this certification pass:

- OAuth live-local test stability:
  - `src/features/mcp-oauth/oauth-authorization-flow.ts` now starts the callback server before opening the authorization URL and closes the server on failure.
  - `src/features/mcp-oauth/discovery.ts` and `src/features/mcp-oauth/provider.ts` now support an injected fetch implementation so the local live test is insulated from other OAuth tests that mutate `globalThis.fetch`.
  - `src/features/mcp-oauth/provider-live-local.test.ts` uses the native fetch binding for the local server flow.
- Target provider fallback shape:
  - `src/host-hooks/provider-fallback.ts` now unwraps wrapped provider response payloads as well as direct response events.
  - `src/host-hooks/provider-fallback.test.ts` adds the wrapped-response regression.
- Consensus removal audit:
  - `src/plugin/consensus-removal.test.ts` keeps the same source scan but raises its timeout to 20 seconds because the repository-sized audit can exceed Bun's default 5 second per-test timeout under one-process load.

Source verification run in `/home/supreme/oh-my-openagent`:

- `timeout 240s bun test src/host-tools/gated-runtime-tools.test.ts src/host-tools/look-at-tool.test.ts src/host-hooks/provider-fallback.test.ts src/host-tools/team-tools.test.ts src/features/mcp-oauth/discovery.test.ts src/features/mcp-oauth/provider.test.ts src/features/mcp-oauth/provider-live-local.test.ts src/plugin/consensus-removal.test.ts`
  - Result: passed, 37 tests, 93 assertions.
- `timeout 180s bun test src/host-resources/command-registration.test.ts src/host-resources/resource-discovery.test.ts src/host-hooks/hook-registration.test.ts src/host-hooks/message-transforms.test.ts src/host-hooks/continuation.test.ts src/host-hooks/tool-guards.test.ts src/host-hooks/openclaw.test.ts src/host-agents/agent-routing.test.ts src/host-tools/always-on-tools.test.ts src/host-tools/mcp-backed-tools.test.ts src/host-tools/hashline-edit-tool.test.ts src/host-tools/task-tools.test.ts src/host-tools/tool-normalization.test.ts src/hosts/oh-my-pi/register-diagnostics.test.ts src/hosts/pi/register-diagnostics.test.ts src/cli/install-targets/install-target-extensions.test.ts`
  - Result: passed, 46 tests, 106 assertions.
- `timeout 120s bun test src/host-hooks/provider-fallback.test.ts`
  - Result: passed, 4 tests, 6 assertions.
- `timeout 120s bun test src/plugin/consensus-removal.test.ts`
  - Result: passed, 3 tests, 4 assertions.
- `timeout 300s bun run typecheck`
  - Result: passed across root, script, and workspace package tsconfigs.
- `timeout 300s bun run build`
  - Result: passed. Fresh bundles emitted for `dist/index.js`, `dist/hosts/oh-my-pi/index.js`, `dist/hosts/pi/index.js`, and `dist/cli/index.js`; schema regenerated.

Oh My Pi source verification in `/home/supreme/pr-work/oh-my-pi`:

- `timeout 600s bun run check`
  - Result: passed. Rust check skipped by repository logic because this was not CI and no Rust-affecting changes were detected. TypeScript check passed.
- `timeout 300s bun test packages/coding-agent/test/sdk-skills.test.ts`
  - Result: passed, 6 tests, 10 assertions.
- `timeout 300s bun run ci:test:smoke`
  - Result: passed. Output included `omp/15.4.2`, help surfaces, stats help, and `smoke-test: ok`.

Pi source verification in `/home/supreme/pi-mono`:

- `timeout 600s npm run check`
  - First result: failed before dependency install with `biome: command not found`.
- `timeout 600s npm ci`
  - Result: passed and installed dependencies. NPM reported 7 vulnerabilities in the existing dependency graph.
- `timeout 600s npm run check`
  - Second result: failed in `packages/web-ui` typecheck with missing workspace declaration outputs, including:
    - `TS2307: Cannot find module '@mariozechner/pi-agent-core' or its corresponding type declarations.`
    - `TS2307: Cannot find module '@mariozechner/pi-ai' or its corresponding type declarations.`
  - Classification: pre-existing Pi repo check precondition, not caused by this port. `/home/supreme/pi-mono/README.md` lines 66-74 say `npm run check` requires `npm run build` first because web-ui needs compiled `.d.ts` files. `docs/NEW-GOAL.md` forbids running Pi `npm run build`, so the check cannot be completed inside the stated constraints.
  - Pi source worktree remains clean.

Installed runtime dogfood, Oh My Pi:

- Runtime root: `/home/supreme/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`
- Extension root: `/home/supreme/.omp/agent/extensions/oh-my-openagent-dev -> /home/supreme/oh-my-openagent`
- Loader probe: `/home/supreme/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/loader.ts`
- Result:

```json
{
  "errors": [],
  "loaded": "/home/supreme/.omp/agent/extensions/oh-my-openagent-dev/dist/hosts/oh-my-pi/index.js",
  "toolCount": 41,
  "commandCount": 10,
  "handlerEvents": [
    "after_provider_response",
    "auto_compaction_end",
    "before_agent_start",
    "before_provider_request",
    "context",
    "input",
    "message_end",
    "resources_discover",
    "session.compacting",
    "session_compact",
    "session_shutdown",
    "session_start",
    "tool_call",
    "tool_result"
  ],
  "hasLookAt": true,
  "teamTools": 12,
  "diag": "Oh My OpenAgent Oh My Pi adapter loaded.",
  "mcpHasLsp": true,
  "taskCreated": true,
  "skillPaths": 3,
  "promptPaths": 2,
  "teamStatus": "active",
  "teamMembers": 2,
  "worktreesExist": true,
  "tmuxSession": "omo-target-team-a29c715f",
  "tmuxPanes": 2,
  "tmuxSessionLive": true
}
```

Installed runtime dogfood, Pi:

- Runtime root: `/home/supreme/.bun/install/global/node_modules/@earendil-works/pi-coding-agent`
- Extension root: `/home/supreme/.pi/agent/extensions/oh-my-openagent-dev -> /home/supreme/oh-my-openagent`
- Loader probe: `/home/supreme/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js`
- Result:

```json
{
  "errors": [],
  "loaded": "/home/supreme/.pi/agent/extensions/oh-my-openagent-dev/dist/hosts/pi/index.js",
  "toolCount": 41,
  "commandCount": 10,
  "handlerEvents": [
    "after_provider_response",
    "before_agent_start",
    "before_provider_request",
    "context",
    "input",
    "message_end",
    "resources_discover",
    "session_compact",
    "session_shutdown",
    "session_start",
    "tool_call",
    "tool_result"
  ],
  "hasLookAt": true,
  "teamTools": 12,
  "diag": "Oh My OpenAgent Pi adapter loaded.",
  "mcpHasLsp": true,
  "taskCreated": true,
  "skillPaths": 3,
  "promptPaths": 2,
  "teamStatus": "active",
  "teamMembers": 2,
  "worktreesExist": true,
  "tmuxSession": "omo-target-team-a8545cfb",
  "tmuxPanes": 2,
  "tmuxSessionLive": true
}
```

Additional installed hook/command inventory probe:

- Both targets reported 10 command registrations.
- Both targets reported two handlers each for `input`, `context`, and `before_agent_start`.
- Direct command invocation through the raw installed loader is blocked until `ExtensionRunner.initialize(...)`, as designed by the target runtime. Source tests cover command message dispatch through a fake initialized API.

Review findings and status:

- Fixed: target provider fallback did not normalize wrapped provider response payloads. Regression added and passed.
- Fixed: OAuth local live test was vulnerable to cross-test `globalThis.fetch` mutation and callback readiness timing. Injected fetch and server-ready flow added, live test passed.
- Fixed: consensus removal source audit could time out under load. Timeout raised, audit still scans the same paths and snippets.
- No fix needed: target Team Mode uses worktree directories, not `git worktree add`, matching the active OpenCode `createTeamRun()` path in `src/features/team-mode/team-runtime/create.ts`. The separate git worktree manager exists but is not the path used by current Team Mode creation.
- Certification caveat: installed Oh My Pi loader dogfood proves resource handler registration and returned skill/prompt roots. Oh My Pi source tests prove `createAgentSession()` consumes extension resource paths. The currently installed global Oh My Pi package copy still lacks the newer SDK resource-consumption source patch, so installed Oh My Pi session-level resource consumption will require reinstalling or updating the global package from the patched source.
- Certification caveat: no live LLM-backed `look_at` or delegated subagent run was performed. Source tests prove command construction and subprocess routing; installed dogfood proves registration. A live provider run would spend configured model credentials.

Safe-to-complete status:

- Source-target adapter work is targeted-test clean.
- Installed loader dogfood is clean for both target runtimes.
- Full root test is intentionally not current by user instruction.
- Pi monorepo `npm run check` remains blocked by its documented build precondition and the goal's no-build rule.

Remaining limitations:

- None for `look_at`, target Team Mode tmux/worktree activation, failed-turn replay, or Skill MCP OAuth local exercise.

## Real headless flow proof, 2026-06-11

The user requested real headless user-flow testing with Xiaomi MiMo v2.5 Pro at medium thinking level, but explicitly requested targeted testing instead of a full root suite.

Full step-by-step retest guide:

- `/home/supreme/oh-my-openagent/docs/porting/full-feature-test-guide-omp-pi.md`

Model flags used:

```bash
--model xiaomi-mimo/mimo-v2.5-pro --thinking medium
```

Focused bundle/runtime fixes from the headless proof:

- `script/patch-node-require-shim.ts` now patches `dist/index.js`, `dist/hosts/oh-my-pi/index.js`, and `dist/hosts/pi/index.js`. Pi imports host bundles through a Node-style ESM loader, so `var __require = import.meta.require` broke with `__require is not a function`.
- `src/shared/dist-bundle-bun-globals.test.ts` now scans all three bundles for top-level `__require(` and `globalThis.Bun` destructuring.
- `src/hosts/oh-my-pi/index.ts` and `src/hosts/pi/index.ts` now resolve the package root with `dirname(fileURLToPath(import.meta.url))` instead of Bun-only `import.meta.dir`.
- Host bundles were rebuilt with:

```bash
bun build src/hosts/oh-my-pi/index.ts src/hosts/pi/index.ts --root src --outdir dist --target bun --format esm --external @ast-grep/napi --external zod
bun run build:node-require-shim
```

Focused checks run after the runtime fixes:

```bash
bun test src/hosts/pi/register-diagnostics.test.ts src/hosts/oh-my-pi/register-diagnostics.test.ts src/shared/dist-bundle-bun-globals.test.ts
node --input-type=module -e "const pi = await import('./dist/hosts/pi/index.js'); const omp = await import('./dist/hosts/oh-my-pi/index.js'); console.log(typeof pi.default + ':' + typeof omp.default)"
```

Result: 7 tests passed across 3 files, 21 assertions. Node import smoke printed `function:function`.

Oh My Pi real headless proof:

- Command shape: temp project with `sample.txt`, `OMO_TEAM_MODE=1`, `omp --mode text --print --no-title`, Xiaomi MiMo medium.
- Prompt required actual tool use: `omo_diagnostic`, `mcp_servers`, `task_create`, and reading `sample.txt`.
- Result: exit 0. Final output reported `DIAG_LOADED: YES`, `MCP_LSP: YES`, `TASK_CREATED: YES`, and `SAMPLE_READ: YES`.
- Disk artifact confirmed: `.omo/tasks/T-b1ac97ef-8f22-43b2-a0d1-abc7eb4b36c3.json` existed with subject `headless dogfood omp ascii` and `threadID: "target-session"`.

Earlier Oh My Pi proof finding:

- A non-ASCII run created `.omo/tasks/T-f9d9e5cc-f4e4-4352-b64d-495e1c9bbfac.json`, then failed with `Could not parse message into JSON` after the MiMo stream split a Unicode checkmark-like token inside a JSON string.
- Classification: the OMO adapter had already executed `task_create`; the remaining failure is an Oh My Pi or provider stream parsing edge. The ASCII proof completed the adapter user flow.

Pi real headless proof:

- The normal `/home/supreme/.pi/agent` run loaded OMO but failed because another installed extension, `pi-hermes-memory`, conflicts with OMO tool names `skill` and `session_search`.
- The proof was rerun with an isolated `PI_CODING_AGENT_DIR` containing only a copy of the model catalog and one extension symlink to `/home/supreme/oh-my-openagent`.
- Command shape: temp project with `sample.txt`, `OMO_TEAM_MODE=1`, `PI_CODING_AGENT_DIR=<temp-agent>`, `pi --mode text --print`, Xiaomi MiMo medium.
- Prompt required actual tool use: `omo_pi_diagnostic`, `mcp_servers`, `task_create`, and reading `sample.txt`.
- Result: exit 0. Final output reported `DIAG_LOADED: YES`, `MCP_LSP: YES`, `TASK_CREATED: YES`, and `SAMPLE_READ: YES`.
- Disk artifact confirmed: `.omo/tasks/T-4e6c88b4-c317-430d-b2a2-1c8a0552d3d3.json` existed with subject `headless dogfood pi proof` and `threadID: "target-session"`.

Updated certification boundary:

- Real headless OMO user flow is proven for both Oh My Pi and Pi with Xiaomi MiMo v2.5 Pro medium.
- Pi proof requires an isolated agent directory unless the conflicting `pi-hermes-memory` extension is disabled or renamed away from OMO tool names.
- Full root `bun test` remains intentionally not rerun by user instruction.

## Full feature headless rerun, 2026-06-11

Temp run state:

- Run root: `/tmp/omo-full-harness-run-SqPtny`
- Isolated Pi agent dir: `/tmp/omo-pi-agent-run-CFfR30`
- Temp LSP dependencies: `/tmp/omo-full-harness-run-SqPtny/lsp-deps/node_modules/.bin`

The Pi isolated agent copied model/auth files without printing their contents and symlinked only `/home/supreme/oh-my-openagent` as an extension.

Additional fixes made during real headless dogfood:

- `src/host-tools/team-tools.ts` now accepts `name` as a team-name alias, because the model naturally used `name` instead of `team_name`.
- `src/host-tools/team-tools.ts` now exposes an explicit JSON schema for common Team Mode parameters including `name`, `team_name`, `members`, `subject`, and `body`, so headless model tool selection reliably sends two-member teams.
- `src/host-tools/team-tools.test.ts` adds the regression for `name` alias plus task list consistency.
- `src/hooks/comment-checker/cli.ts` now uses `bunWhich` instead of defaulting to `Bun.which`.
- `src/cli/run/opencode-binary-resolver.ts` now uses `bunWhich` instead of defaulting to `Bun.which`.
- `src/shared/dist-bundle-bun-globals.test.ts` now scans all three dist bundles for raw Bun runtime API calls, not just `dist/index.js`.

Focused verification after these fixes:

```bash
bun build src/hosts/oh-my-pi/index.ts src/hosts/pi/index.ts --root src --outdir dist --target bun --format esm --external @ast-grep/napi --external zod
bun run build:node-require-shim
bun test src/host-tools/team-tools.test.ts
bun test src/shared/dist-bundle-bun-globals.test.ts src/hooks/comment-checker/cli.test.ts src/cli/run/opencode-binary-resolver.test.ts
```

Results:

- Team Mode focused tests: 2 passed, 14 assertions.
- Bundle/raw-Bun plus resolver tests: 22 passed, 38 assertions.
- Pi post-fix smoke had no `Bun is not defined` or `Extension error` output.

Oh My Pi broad feature run:

- Command shape: `omp --mode text --print --no-title --model xiaomi-mimo/mimo-v2.5-pro --thinking medium`, `OMO_TEAM_MODE=1`.
- Prompt required diagnostics, MCP inventory, LSP symbols, ast-grep, glob, grep, task create/list, hashline edit attempt, and Team Mode create/status/task/message/list.
- Initial broad result: exit 0. Diagnostics, MCP inventory, ast-grep, glob, grep, task persistence, Team Mode create/status/task/message/list all executed. LSP initially failed because `typescript-language-server` was not on PATH. Hashline broad run fell back to ordinary write because target read output did not provide line hash anchors. Team task list failed due the model using `name` while the adapter only indexed `team_name`.
- Narrow LSP rerun after temp installing `typescript` and `typescript-language-server`: `LSP_SYMBOLS: PASS`, found `add` and `multiply`.
- Narrow Team rerun after alias/schema fix: `TEAM_CREATE`, `TEAM_MEMBERS`, and `TEAM_TASK_LIST` all passed; persisted state for `ompmembers` contained both `sisyphus` and `atlas`.
- Narrow hashline rerun with explicit anchor `9#TY`: valid edit passed and stale anchor `9#ZZ` was rejected. File inspection confirmed `export const hashlineValue = add(2, 3)`.

Oh My Pi persisted artifacts:

- `.omo/tasks/T-69522cd6-35e5-4526-9735-51a72631127a.json`, subject `omp full feature flow`.
- `.omo/target-team-index.json` contained `ompmembers`.
- `.omo/target-team-mode/runtime/8a9c95b8-b37b-4874-823c-65031d0bafcb/state.json` contained `teamName: "ompmembers"` with `sisyphus` and `atlas`.
- `.omo/target-team-mode/runtime/8a9c95b8-b37b-4874-823c-65031d0bafcb/tasks/1.json`, subject `two member task`.

Pi broad feature run:

- Command shape: `PI_CODING_AGENT_DIR=/tmp/omo-pi-agent-run-CFfR30 pi --mode text --print --model xiaomi-mimo/mimo-v2.5-pro --thinking medium`, `OMO_TEAM_MODE=1`.
- Prompt required diagnostics, MCP inventory, LSP symbols, ast-grep, glob, grep, task create/list, hashline edit, and Team Mode create/status/task/message/list.
- Broad result: exit 0. Diagnostics, MCP inventory, LSP symbols, glob, grep, task persistence, hashline edit, Team Mode create/status/task/message/list all passed. Initial ast-grep pattern missed exported functions.
- Narrow ast-grep rerun with exported-function pattern: `AST_GREP_EXPORTED_FUNCTIONS: PASS`, found `add` and `multiply`.
- Initial Pi broad output showed two `Bun is not defined` extension errors, then recovered. After replacing raw `Bun.which` defaults and widening the dist audit, the Pi post-fix smoke printed diagnostics and MCP inventory with no `Bun is not defined` or `Extension error` output.

Pi persisted artifacts:

- `.omo/tasks/T-4c28bdf3-a0da-4cf8-9689-920bb7048a7c.json`, subject `pi full feature flow`.
- `src/hashline-target.ts` contained `export const hashlineValue = add(2, 3)`.
- `.omo/target-team-index.json` contained `pimembers`.
- `.omo/target-team-mode/runtime/24c57bef-efc2-4e2d-b76e-4c9080e09b51/state.json` contained `teamName: "pimembers"` with `sisyphus` and `atlas`.
- `.omo/target-team-mode/runtime/24c57bef-efc2-4e2d-b76e-4c9080e09b51/tasks/1.json`, subject `pi team proof`.
- Team message inbox files existed for both `sisyphus` and `atlas`.

Full-feature proof status:

- Real headless user-flow testing is complete for both `omp` and `pi` using Xiaomi MiMo v2.5 Pro medium.
- The proof is targeted runtime testing plus focused regressions, not a full root `bun test`.
- Pi normal agent dir still has the external `pi-hermes-memory` conflict; isolated `PI_CODING_AGENT_DIR` remains the clean proof path.
- The full feature test guide remains at `/home/supreme/oh-my-openagent/docs/porting/full-feature-test-guide-omp-pi.md`.
