# docs/ — User-Facing Documentation

**Generated:** 2026-09-10 / bee8c2ba4

## OVERVIEW

32 Markdown documents (excluding this file), 3 JSONC examples and one rules template across 6 subdirectories plus root files. Existing index retained for the distinct documentation domain (score 5). The web site at [packages/web/](../packages/web) compiles nine selected documents; legal policies are linked separately.

## WHERE TO LOOK

| Audience / Task | Location |
|------|----------|
| New users — what is this? | [docs/guide/overview.md](guide/overview.md) |
| Installing Ultimate, Light or Senpi | [docs/guide/installation.md](guide/installation.md) |
| Installing the compiled binary | [docs/guide/binary-install.md](guide/binary-install.md) |
| How agents collaborate | [docs/guide/orchestration.md](guide/orchestration.md) |
| Picking the right model per agent | [docs/guide/agent-model-matching.md](guide/agent-model-matching.md) |
| Team Mode (opt-in multi-agent) | [docs/guide/team-mode.md](guide/team-mode.md) |
| Senpi task delegation and teams | [docs/guide/senpi-task.md](guide/senpi-task.md) |
| Temporary BTW side conversations | [docs/guide/btw.md](guide/btw.md) |
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
| Senpi telemetry internals | [docs/reference/senpi-telemetry.md](reference/senpi-telemetry.md) |
| `omo-ai` npm publishing playbook | [docs/reference/omo-ai-publishing.md](reference/omo-ai-publishing.md) |
| mass-ULW dag protocol (events, catch-up, overflow) | [docs/reference/mass-ulw-protocol.md](reference/mass-ulw-protocol.md) |
| Monitor tool reference | [docs/reference/monitor.md](reference/monitor.md) |
| Web-terminal visual QA helper | [docs/reference/web-terminal-visual-qa.md](reference/web-terminal-visual-qa.md) |
| Managed development binary and isolated feature builds | [docs/reference/omob-dev-binary.md](reference/omob-dev-binary.md) |
| Sample configs | [docs/examples/](examples) (default, coding-focused, planning-focused) |
| Privacy & ToS | [docs/legal/](legal) |
| Manifesto | [docs/manifesto.md](manifesto.md) |
| Refreshing the model-capabilities cache | [docs/model-capabilities-maintenance.md](model-capabilities-maintenance.md) |
| Ollama troubleshooting | [docs/troubleshooting/ollama.md](troubleshooting/ollama.md) |
| Copyable project rules template | [docs/templates/AGENTS.md.example](templates/AGENTS.md.example) |

## STRUCTURE

```text
docs/
├── manifesto.md                              # The "why" — referenced from README
├── model-capabilities-maintenance.md         # How model-capabilities cache is refreshed
├── guide/                                    # User-facing tutorial-style guides (8 files)
├── reference/                                # API / config / CLI reference (19 files)
├── examples/                                 # Sample JSONC configs (3 files)
├── legal/                                    # privacy-policy.md + terms-of-service.md
├── templates/
│   └── AGENTS.md.example                     # Copyable OMO project rules template
└── troubleshooting/
    └── ollama.md
```

## CONVENTIONS

- **User-facing language only in `guide/` and `reference/`.** No `OmO` internal jargon without explanation.
- **Path links** use relative Markdown targets. The web generator rewrites links between selected docs to section anchors; absolute `file://` links are not portable published-doc links.
- **No HTML.** Markdown only. No `<details>` / `<summary>` (causes rendering issues in some terminals).
- **Code blocks** use language fences. Use `jsonc` for config snippets to preserve comments.
- **Visual QA evidence** must come from the real-pty + xterm.js flow ([`script/qa/web-terminal-visual-qa.mjs`](../script/qa/web-terminal-visual-qa.mjs)). NEVER use `tmux capture-pane` for color/visual/CJK evidence; tmux is boot-smoke only.
- **Web content selection** lives in [`packages/web/lib/docs-sections-data.mjs`](../packages/web/lib/docs-sections-data.mjs); [`generate-docs-content.mjs`](../packages/web/scripts/generate-docs-content.mjs) compiles it into `lib/docs-content.generated.ts`. Edit source docs, not generated HTML strings.
- **All `docs/**` changes trigger web CI**, not only docs about the web package; [`web-ci.yml`](../.github/workflows/web-ci.yml) and [`web-deploy.yml`](../.github/workflows/web-deploy.yml) both watch that path.

## ANTI-PATTERNS

- Never add a doc to `guide/` or `reference/` without a `WHERE TO LOOK` entry above.
- Never paste agent-facing system prompts here. Those live in [`packages/omo-opencode/src/agents/`](../packages/omo-opencode/src/agents/) or [`packages/skills-loader-core/src/features/builtin-skills/`](../packages/skills-loader-core/src/features/builtin-skills/).
- Never document changing config keys without updating the owning schema: [`omo-config-core/src/schema/`](../packages/omo-config-core/src/schema/) for unified fields, [`omo-opencode/src/config/schema/`](../packages/omo-opencode/src/config/schema/) for plugin fields. `bun run build:schema` regenerates both schema artifacts; `bun run build:omo-schema` regenerates only the unified schema.
