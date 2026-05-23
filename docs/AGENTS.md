# docs/ — User-Facing Documentation

**Generated:** 2026-05-20

## OVERVIEW

19 Markdown files across 6 subdirectories + 2 root files. Categorized by audience: user-facing guides + reference, internal design docs (superpowers/), troubleshooting, legal. The web site at [packages/web/](file:///Users/yeongyu/local-workspaces/omo/packages/web/) consumes some of these (via `web-deploy.yml` triggers).

## WHERE TO LOOK

| Audience / Task | Location |
|------|----------|
| New users — what is this? | [docs/guide/overview.md](file:///Users/yeongyu/local-workspaces/omo/docs/guide/overview.md) |
| Installing the plugin | [docs/guide/installation.md](file:///Users/yeongyu/local-workspaces/omo/docs/guide/installation.md) |
| How agents collaborate | [docs/guide/orchestration.md](file:///Users/yeongyu/local-workspaces/omo/docs/guide/orchestration.md) |
| Picking the right model per agent | [docs/guide/agent-model-matching.md](file:///Users/yeongyu/local-workspaces/omo/docs/guide/agent-model-matching.md) |
| Team Mode (opt-in multi-agent) | [docs/guide/team-mode.md](file:///Users/yeongyu/local-workspaces/omo/docs/guide/team-mode.md) |
| Configuration field reference | [docs/reference/configuration.md](file:///Users/yeongyu/local-workspaces/omo/docs/reference/configuration.md) |
| Feature-by-feature reference | [docs/reference/features.md](file:///Users/yeongyu/local-workspaces/omo/docs/reference/features.md) |
| CLI command reference | [docs/reference/cli.md](file:///Users/yeongyu/local-workspaces/omo/docs/reference/cli.md) |
| Known issues & workarounds | [docs/reference/known-issues.md](file:///Users/yeongyu/local-workspaces/omo/docs/reference/known-issues.md) |
| `prompt_async_gate` deep-dive | [docs/reference/prompt-async-gate-rfc.md](file:///Users/yeongyu/local-workspaces/omo/docs/reference/prompt-async-gate-rfc.md) |
| Release process | [docs/reference/release-process.md](file:///Users/yeongyu/local-workspaces/omo/docs/reference/release-process.md) |
| Rules-injector cross-module comparison | [docs/reference/rules-injection-cross-module-comparison.md](file:///Users/yeongyu/local-workspaces/omo/docs/reference/rules-injection-cross-module-comparison.md) |
| Sample configs | [docs/examples/](file:///Users/yeongyu/local-workspaces/omo/docs/examples/) (default, coding-focused, planning-focused) |
| Privacy & ToS | [docs/legal/](file:///Users/yeongyu/local-workspaces/omo/docs/legal/) |
| Manifesto | [docs/manifesto.md](file:///Users/yeongyu/local-workspaces/omo/docs/manifesto.md) |
| Ollama troubleshooting | [docs/troubleshooting/ollama.md](file:///Users/yeongyu/local-workspaces/omo/docs/troubleshooting/ollama.md) |
| Internal design plans/specs | [docs/superpowers/plans/](file:///Users/yeongyu/local-workspaces/omo/docs/superpowers/plans/) + [docs/superpowers/specs/](file:///Users/yeongyu/local-workspaces/omo/docs/superpowers/specs/) |

## STRUCTURE

```
docs/
├── manifesto.md                              # The "why" — referenced from README
├── model-capabilities-maintenance.md         # How model-capabilities cache is refreshed
├── guide/                                    # User-facing tutorial-style guides (5 files)
├── reference/                                # API / config / CLI reference (7 files)
├── examples/                                 # Sample JSONC configs (3 files)
├── legal/                                    # privacy-policy.md + terms-of-service.md
├── superpowers/
│   ├── plans/                                # In-flight design plans (model-settings, background-task-retry, log-rotation)
│   └── specs/                                # Frozen design specs (model-settings-compatibility, background-task-retry-timeline)
└── troubleshooting/
    └── ollama.md
```

## CONVENTIONS

- **User-facing language only in `guide/` and `reference/`.** No `OmO` internal jargon without explanation.
- **`superpowers/` is internal.** Design docs, plans, RFCs. Outside readers should not be expected to follow these.
- **Path links** use the `file://` scheme so OpenCode renders them in TUI. Use absolute paths.
- **No HTML.** Markdown only. No `<details>` / `<summary>` (causes rendering issues in some terminals).
- **Code blocks** use language fences. Use `jsonc` for config snippets to preserve comments.
- **Docs touching `packages/web/` re-trigger the web CI** via [`web-ci.yml`](file:///Users/yeongyu/local-workspaces/omo/.github/workflows/web-ci.yml).

## ANTI-PATTERNS

- Never add a doc to `guide/` or `reference/` without a `WHERE TO LOOK` entry above.
- Never paste agent-facing system prompts here. Those live in [`src/agents/`](file:///Users/yeongyu/local-workspaces/omo/src/agents/) or [`src/features/builtin-skills/`](file:///Users/yeongyu/local-workspaces/omo/src/features/builtin-skills/).
- Never document changing config keys without also updating [`src/config/schema/`](file:///Users/yeongyu/local-workspaces/omo/src/config/schema/) and re-running `bun run build:schema`.
