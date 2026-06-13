# Shared Core Multi-PR Extraction

This plan pins the shared core extraction work for OpenCode and Codex adapters.
Each PR is intentionally small, lands through `dev`, and preserves observable
behavior before moving logic into harness-neutral packages.

The current extraction surface includes `utils`, `rules-engine`,
`agents-md-core`, `model-core`, `prompts-core`, `comment-checker-core`,
`hashline-core`, `boulder-state`, `telemetry-core`, `ast-grep-core`,
`lsp-core`, `mcp-stdio-core`, `mcp-client-core`, `tmux-core`, `team-core`,
`openclaw-core`, `claude-code-compat-core`, `skills-loader-core`, and
`delegate-core`. Release and packaging PRs must keep the root npm tarball,
`lazycodex-ai` tarball, and `code-yeongyu/lazycodex` marketplace payload in
sync with those package boundaries.

## PR Matrix

| PR | Scope | Required proof |
|---|---|---|
| PR F | Core guardrails and QA conventions | `typecheck:packages`, boundary audit, QA matrix test |
| PR 1 | Codex rules component uses `rules-engine` | Rules component characterization, OpenCode rules tests |
| PR 2 | Keyword and mode detector pure logic | Prompt byte preservation, OpenCode and Codex detector tests |
| PR 3 | Comment-checker request shaping | Write/Edit/MultiEdit/apply_patch request equivalence tests |
| PR 4 | Boulder continuation reader | Checklist and continuation state reader tests |
| PR 5 | Telemetry core | Daily activity, opt-out, capture, and shutdown isolation tests |
| PR 6 | LSP hook policy helpers | Mutation path ordering, diagnostics formatting, truncation tests |
| PR 7 | Context-pressure helper | Marker detection tests and duplicate constant guard |

## Required QA

Every PR must use TDD: capture a passing baseline, add a failing RED test or
structural guard, implement the smallest extraction, then capture GREEN on the
same command.

Every PR must run LSP diagnostics when available. If the LSP MCP is unavailable,
`bun run typecheck` is the fallback evidence and the changed TypeScript files
must be recorded.

Every PR must run ast-grep checks for forbidden adapter coupling, `as any`, raw
`session.prompt`, and raw `session.promptAsync` patterns. PR-specific structural
searches must be added for the logic being extracted.

Every PR must run Codex fresh environment QA through an isolated `CODEX_HOME`
install and verify the `omo@sisyphuslabs` marketplace identity appears in the
generated config.

Every PR must run opencode-qa HTTP/SSE checks with the isolated server smoke and
SSE hook probe scripts. Adapter behavior PRs must also record an attached
server probe for the changed hook surface.

Publish pipeline PRs must additionally run `bun test script/`, `bun pm pack
--dry-run --ignore-scripts`, a full local LazyCodex marketplace sync, and a
`--previous-payload` tarball-layout sync simulation. The evidence must include
the packed `install-dist` and `plugin/skills` entries, the copied
`plugins/omo/components/*/dist/cli.js` files, and cleanup receipts for every
temporary pack directory, extracted package root, and marketplace repository.

Before merge, every PR must pass local verification, GitHub CI, review-work, and
Cubic with no blocking issues. Merge into `dev` with a merge commit only.
