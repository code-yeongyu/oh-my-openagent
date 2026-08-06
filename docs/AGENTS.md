# docs/ — User-Facing Documentation

**Generated:** 2026-07-17 / 7d664b96b

## OVERVIEW

~26 Markdown files across 6 subdirectories (guide, reference, examples, legal, templates, troubleshooting) + root files. Categorized by audience: user-facing guides + reference, troubleshooting, legal. The web site at [packages/web/](../packages/web) consumes some of these (via `web-deploy.yml` triggers).

## WHERE TO LOOK

| Audience / Task | Location |
|------|----------|
| New users — what is this? | [docs/guide/overview.md](guide/overview.md) |
| Installing the plugin | [docs/guide/installation.md](guide/installation.md) |
| How agents collaborate | [docs/guide/orchestration.md](guide/orchestration.md) |
| Picking the right model per agent | [docs/guide/agent-model-matching.md](guide/agent-model-matching.md) |
| Team Mode (opt-in multi-agent) | [docs/guide/team-mode.md](guide/team-mode.md) |
| Senpi task delegation and teams | [docs/guide/senpi-task.md](guide/senpi-task.md) |
| Configuration field reference | [docs/reference/configuration.md](reference/configuration.md) |
| Harness-neutral `omo.json` config reference | [docs/reference/omo-json.md](reference/omo-json.md) |
| Feature-by-feature reference | [docs/reference/features.md](reference/features.md) |
| CLI command reference | [docs/reference/cli.md](reference/cli.md) |
| Known issues & workarounds | [docs/reference/known-issues.md](reference/known-issues.md) |
| `prompt_async_gate` deep-dive | [docs/reference/prompt-async-gate-rfc.md](reference/prompt-async-gate-rfc.md) |
| Shared core multi-PR extraction QA | [docs/reference/shared-core-multi-pr.md](reference/shared-core-multi-pr.md) |
| Re-export shim inventory | [docs/reference/re-export-shim-inventory.md](reference/re-export-shim-inventory.md) |
| Release process | [docs/reference/release-process.md](reference/release-process.md) |
| GitHub PR evidence attachments | [docs/reference/github-attachment-upload.md](reference/github-attachment-upload.md) |
| Claiming the lazycodex npm name | [docs/reference/lazycodex-npm-reservation.md](reference/lazycodex-npm-reservation.md) |
| Rules-injector cross-module comparison | [docs/reference/rules-injection-cross-module-comparison.md](reference/rules-injection-cross-module-comparison.md) |
| Codex telemetry internals | [docs/reference/codex-telemetry.md](reference/codex-telemetry.md) |
| Monitor tool reference | [docs/reference/monitor.md](reference/monitor.md) |
| Web-terminal visual QA helper | [docs/reference/web-terminal-visual-qa.md](reference/web-terminal-visual-qa.md) |
| Sample configs | [docs/examples/](examples) (default, coding-focused, planning-focused) |
| Privacy & ToS | [docs/legal/](legal) |
| Manifesto | [docs/manifesto.md](manifesto.md) |
| Ollama troubleshooting | [docs/troubleshooting/ollama.md](troubleshooting/ollama.md) |
| Copyable project rules template | [docs/templates/AGENTS.md.example](templates/AGENTS.md.example) |

## STRUCTURE

```
docs/
├── manifesto.md                              # The "why" — referenced from README
├── model-capabilities-maintenance.md         # How model-capabilities cache is refreshed
├── guide/                                    # User-facing tutorial-style guides (6 files)
├── reference/                                # API / config / CLI reference (15 files)
├── examples/                                 # Sample JSONC configs (3 files)
├── legal/                                    # privacy-policy.md + terms-of-service.md
├── templates/
│   └── AGENTS.md.example                     # Copyable OMO project rules template
└── troubleshooting/
    └── ollama.md
```

## CONVENTIONS

- **User-facing language only in `guide/` and `reference/`.** No `OmO` internal jargon without explanation.
- **Path links** use the `file://` scheme so OpenCode renders them in TUI. Use absolute paths.
- **No HTML.** Markdown only. No `<details>` / `<summary>` (causes rendering issues in some terminals).
- **Code blocks** use language fences. Use `jsonc` for config snippets to preserve comments.
- **Docs touching `packages/web/` re-trigger the web CI** via [`web-ci.yml`](../.github/workflows/web-ci.yml).

## ANTI-PATTERNS

- Never add a doc to `guide/` or `reference/` without a `WHERE TO LOOK` entry above.
- Never paste agent-facing system prompts here. Those live in [`packages/omo-opencode/src/agents/`](../packages/omo-opencode/src/agents/) or [`packages/omo-opencode/src/features/builtin-skills/`](../packages/omo-opencode/src/features/builtin-skills/).
- Never document changing config keys without also updating [`packages/omo-opencode/src/config/schema/`](../packages/omo-opencode/src/config/schema/) and re-running `bun run build:schema`.
