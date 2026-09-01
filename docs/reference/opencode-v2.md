# OpenCode V2 Support (opencode2)

oh-my-openagent ships as a dual-host plugin: the same published package works under both OpenCode V1 (`opencode`) and OpenCode V2 (`opencode2`, beta channel).

## How it works

The package's default export is a dual-shape module:

- **V1** (`opencode`) loads it as a `PluginModule` and calls `.server(input)` — unchanged from previous releases.
- **V2** (`opencode2`) loads it and calls `.setup(ctx)` — the V2 plugin API. The V2 host ignores the extra `server` key (verified live against `opencode2` 0.0.0-beta-18721).

Inside `setup`, the V2 bridge reuses the entire existing V1 plugin: it builds a compat client over the V2 server API, runs the same staged initialization (agents, tools, hooks, managers), then registers everything through the V2 surfaces:

| V2 surface | What is registered |
|---|---|
| `ctx.agent.transform` | all OMO agents (Sisyphus, Hephaestus, Prometheus, Atlas, subagents) |
| `ctx.tool.transform` | the registry tools (grep, glob, session manager, background tasks, task delegation, skill, look_at, ...) as Code Mode tools |
| `ctx.mcp.transform` | the built-in MCPs (lsp, codegraph, git-bash, websearch, grep_app, context7, ...) |
| `ctx.command.transform` | built-in slash commands |
| `ctx.session.hook` | prompt admission (`chat.message` chain), context/generation (`chat.params` + system transforms), request headers (`chat.headers`) |
| `ctx.tool.hook` | tool `execute.before` / `execute.after` guard chains |
| `ctx.event.subscribe` | session lifecycle events feeding the V1 event pipeline |

## Installing under V2

Add the package to your `opencode.json(c)` `plugins` array:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["oh-my-openagent"]
}
```

or run `opencode2 plugin add oh-my-openagent`. The `./v2` subpath export (`dist/v2/index.js`) re-exports the same dual-host module for hosts that prefer the explicit subpath.

## V2 notes

- **Code Mode tools.** V2 exposes plugin tools through its Code Mode catalog as `tools.<name>` entries reachable via the `execute` tool, not as flat model-facing tool definitions. This is how V2 surfaces every plugin's tools; the bridge registers ours with the required `codemode` option so they appear in the catalog and are callable (`tools.background_output({...})`, `tools.look_at({...})`, ...).
- **Agent system prompts flow normally.** Agents registered by the bridge carry their full prompts; sessions switched to an OMO agent send that agent's system message to the provider.

## Known gaps under V2 (beta)

The V2 server removed several V1 APIs the plugin uses. The bridge degrades them gracefully (warn-once, no crashes) instead of pretending they exist:

| V1 capability | V2 status | Bridge behavior |
|---|---|---|
| `session.todo` API | no equivalent | todo lists read as empty (boulder / todo-continuation become no-ops) |
| TUI toasts (`tui.showToast`) | CLI-plugin surface only | no-op |
| `session.status` / `session.children` | removed | approximated (idle / empty) |
| `session.summarize` | `compact` | remapped |
| Compaction hooks (`session.compacting`, `autocontinue`) | no hook surface | not registered |

These will be revisited as the V2 beta stabilizes.

## QA evidence

Live-run proof against `opencode2` beta (isolated sandbox, mock provider, no real API calls): agents registered and visible via `/api/agent`, MCPs connected, Code Mode catalog contains the bridged tools with converted JSON Schemas, and a model-driven `tools.background_cancel` call executed through the V1 tool chain end-to-end. See `.omo/evidence/20260831-opencode-v2-dual-host/`.
