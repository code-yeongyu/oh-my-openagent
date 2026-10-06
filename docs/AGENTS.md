# docs/ — User-Facing Documentation

**Generated:** 2026-08-24 / f3642fcda

## OVERVIEW

30 tracked Markdown files across 6 subdirectories (guide 7, reference 18, examples 3 JSONC, legal 2, templates 1, troubleshooting 1) + root files. Categorized by audience: user-facing guides + reference, troubleshooting, legal. The web site at [packages/web/](../packages/web) consumes some of these (via `web-deploy.yml` triggers).

## WHERE TO LOOK

| Audience / Task | Location |
|------|----------|
| New users — what is this? | [docs/guide/overview.md](guide/overview.md) |
| Installing OmO with the one-line installer (omo.dev/docs/install) | [docs/guide/install.md](guide/install.md) |
| Installing the plugin | [docs/guide/installation.md](guide/installation.md) |
| Installing the compiled binary | [docs/guide/binary-install.md](guide/binary-install.md) |
| How agents collaborate | [docs/guide/orchestration.md](guide/orchestration.md) |
| Picking the right model per agent | [docs/guide/agent-model-matching.md](guide/agent-model-matching.md) |
| Team Mode (opt-in multi-agent) | [docs/guide/team-mode.md](guide/team-mode.md) |
| Senpi task delegation and teams | [docs/guide/senpi-task.md](guide/senpi-task.md) |
| Desktop computer use setup and safety | [docs/guide/computer-use.md](guide/computer-use.md) |
| Temporary BTW side conversations | [docs/guide/btw.md](guide/btw.md) |
| Workflows (mass ulw) for users, omo.dev/docs/workflows | [docs/guide/workflows.md](guide/workflows.md) |
| Delegated agents and the Desktop Agents panel, omo.dev/docs/agents | [docs/guide/agents.md](guide/agents.md) |
| Reserved keywords (ulw, ulw loop, ulw plan, ulw research, mass ulw), omo.dev/docs/keywords | [docs/guide/keywords.md](guide/keywords.md) |
| Telemetry in plain words and how to opt out, omo.dev/docs/telemetry | [docs/guide/telemetry.md](guide/telemetry.md) |
| OmO Desktop updates, release notes and tracks, omo.dev/docs/desktop-updates | [docs/guide/desktop-updates.md](guide/desktop-updates.md) |
| Configuration field reference | [docs/reference/configuration.md](reference/configuration.md) |
| Harness-neutral `omo.json` config reference | [docs/reference/omo-json.md](reference/omo-json.md) |
| Native `computer` tool contract | [docs/reference/computer.md](reference/computer.md) |
| Feature-by-feature reference | [docs/reference/features.md](reference/features.md) |
| CLI command reference | [docs/reference/cli.md](reference/cli.md) |
| Engine hosts per session, `omo daemon`, migration and rollback | [docs/reference/omo-daemon.md](reference/omo-daemon.md) |
| `omo thread` CLI and thread SDK for scripts and connectors (JSON shapes, exit codes) | [docs/reference/omo-thread.md](reference/omo-thread.md) |
| Known issues & workarounds | [docs/reference/known-issues.md](reference/known-issues.md) |
| `prompt_async_gate` deep-dive | [docs/reference/prompt-async-gate-rfc.md](reference/prompt-async-gate-rfc.md) |
| Shared core multi-PR extraction QA | [docs/reference/shared-core-multi-pr.md](reference/shared-core-multi-pr.md) |
| Re-export shim inventory | [docs/reference/re-export-shim-inventory.md](reference/re-export-shim-inventory.md) |
| Release process | [docs/reference/release-process.md](reference/release-process.md) |
| GitHub PR evidence attachments | [docs/reference/github-attachment-upload.md](reference/github-attachment-upload.md) |
| Claiming the lazycodex npm name | [docs/reference/lazycodex-npm-reservation.md](reference/lazycodex-npm-reservation.md) |
| Rules-injector cross-module comparison | [docs/reference/rules-injection-cross-module-comparison.md](reference/rules-injection-cross-module-comparison.md) |
| Codex telemetry internals | [docs/reference/codex-telemetry.md](reference/codex-telemetry.md) |
| Senpi telemetry internals | [docs/reference/senpi-telemetry.md](reference/senpi-telemetry.md) |
| `omo-ai` npm publishing playbook | [docs/reference/omo-ai-publishing.md](reference/omo-ai-publishing.md) |
| mass-ULW dag protocol (events, catch-up, overflow) | [docs/reference/mass-ulw-protocol.md](reference/mass-ulw-protocol.md) |
| Monitor tool reference | [docs/reference/monitor.md](reference/monitor.md) |
| Web-terminal visual QA helper | [docs/reference/web-terminal-visual-qa.md](reference/web-terminal-visual-qa.md) |
| Sample configs | [docs/examples/](examples) (default, coding-focused, planning-focused) |
| Privacy & ToS | [docs/legal/](legal) |
| Manifesto | [docs/manifesto.md](manifesto.md) |
| Refreshing the model-capabilities cache | [docs/model-capabilities-maintenance.md](model-capabilities-maintenance.md) |
| Ollama troubleshooting | [docs/troubleshooting/ollama.md](troubleshooting/ollama.md) |
| Copyable project rules template | [docs/templates/AGENTS.md.example](templates/AGENTS.md.example) |

## STRUCTURE

```
docs/
├── manifesto.md                              # The "why" — referenced from README
├── model-capabilities-maintenance.md         # How model-capabilities cache is refreshed
├── guide/                                    # User-facing tutorial-style guides (7 files)
├── reference/                                # API / config / CLI reference (18 files)
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
- **Visual QA evidence** must come from the real-pty + xterm.js flow ([`script/qa/web-terminal-visual-qa.mjs`](../script/qa/web-terminal-visual-qa.mjs)). NEVER use `tmux capture-pane` for color/visual/CJK evidence; tmux is boot-smoke only.
- **Docs touching `packages/web/` re-trigger the web CI** via [`web-ci.yml`](../.github/workflows/web-ci.yml).

## ANTI-PATTERNS

- Never add a doc to `guide/` or `reference/` without a `WHERE TO LOOK` entry above.
- Never paste agent-facing system prompts here. Those live in [`packages/omo-opencode/src/agents/`](../packages/omo-opencode/src/agents/) or [`packages/skills-loader-core/src/features/builtin-skills/`](../packages/skills-loader-core/src/features/builtin-skills/).
- Never document changing config keys without also updating [`packages/omo-opencode/src/config/schema/`](../packages/omo-opencode/src/config/schema/) and re-running `bun run build:schema`.
