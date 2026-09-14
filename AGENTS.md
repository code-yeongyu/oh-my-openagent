# oh-my-openagent - Multi-Harness Agent OS

**Generated:** 2026-09-14 | **Base:** c8f1de1bb | **Release line:** v5 beta

## OVERVIEW

Bun/TypeScript monorepo for OMO across OpenCode, Codex, Senpi, and the native launcher. The repository is in an active multi-harness extraction: adapter packages own harness wiring; reusable behavior belongs in sibling core packages. Read `ROADMAP.md` before structural work.

## REPOSITORY MAP

| Area | Purpose | Local guide |
|---|---|---|
| `packages/omo-opencode/` | OpenCode Ultimate adapter, hooks, tools, CLI | `packages/omo-opencode/src/AGENTS.md` |
| `packages/omo-codex/` | Codex Light adapter and installer | `packages/omo-codex/AGENTS.md` |
| `packages/omo-senpi/` | Senpi adapter and live QA drivers | `packages/omo-senpi/AGENTS.md` |
| `packages/omo-native/` | Native `omo-ai` launcher | `packages/omo-native/AGENTS.md` |
| `packages/senpi-task/` | Task, team, RPC, and DAG engine | `packages/senpi-task/AGENTS.md` |
| `packages/*-core/` | Harness-neutral reusable modules | `packages/AGENTS.md` |
| `packages/*-mcp/` | LSP, Git Bash, AST-grep, stdio MCPs | package-local guides |
| `packages/shared-skills/` | Cross-harness skill sources | `packages/shared-skills/AGENTS.md` |
| `packages/web/` | Next.js marketing site, separate lockfile | `packages/web/AGENTS.md` |
| `script/` | Bun build, CI, release, and audit automation | `script/AGENTS.md` |
| `scripts/` | Plain Node third-party notice helpers | `scripts/AGENTS.md` |
| `assets/` | Generated schemas and help artifacts | `assets/AGENTS.md` |
| `tests/` | Cross-package invariants and fixtures | `tests/AGENTS.md` |
| `.agents/` | Authoritative project skills and commands | `.agents/AGENTS.md` |

## INITIALIZATION FLOW

OpenCode enters at `packages/omo-opencode/src/index.ts`, delegates to `testing/create-plugin-module.ts`, loads unified config, creates managers/tools/hooks, then exposes 14 hook handlers. Core behavior should move out of the adapter when it does not require OpenCode types.

Codex installs the vendored `omo@sisyphuslabs` plugin from `packages/omo-codex/`; Senpi loads the TypeScript extension in `packages/omo-senpi/`; native distribution resolves one canonical agent directory through `packages/omo-native/bin/lib/agent-dir.js`.

## CONFIGURATION

Canonical config is `~/.omo/omo.json[c]`, overlaid by nearest project `.omo/omo.json[c]`. Resolution order is shared base, harness block, active profile, profile harness block, then defaults. Legacy `oh-my-*` files are migration inputs only.

Harness blocks are `opencode`, `codex`, and `senpi`. Project layers cannot extend user-only MCP environment allowlists or browser automation arguments.

## ARCHITECTURE INVARIANTS

- Keep core packages harness-neutral; adapter imports point inward, never the reverse.
- Route every internal OpenCode `session.prompt*` write through `dispatchInternalPrompt`; raw calls outside the shared gate are forbidden.
- Preserve canonical agent order: Sisyphus, Hephaestus, Prometheus, Atlas.
- Pair Hashline reads and edits: reads emit content hashes and edits reject stale hashes.
- Keep skill precedence numeric: opencode-project > project > opencode > user > config > builtin/shared.
- Treat `.agents/` as authoritative. Add new skills there; update transitional `.opencode/` copies only when a shared artifact must remain byte-identical.
- Resolve native agent state through `canonicalAgentDir()` / `resolveAgentHome()`; do not compose private defaults.

## CHANGE WORKFLOW

Every user-ordered patch uses a fresh task-owned worktree, a plan on disk, atomic todos, an active ulw-loop goal, evidence-bound verification, and a PR to `dev`. Work remains unfinished until required checks and review pass, the PR is merged with a merge commit, and the worktree is removed.

Changes connected to a harness require real-surface QA and evidence under `.omo/evidence/`:

- OpenCode: load `.agents/skills/opencode-qa/`, use an isolated XDG sandbox, and prove relevant hook events when hooks change.
- Codex: load `.agents/skills/codex-qa/`, use isolated `CODEX_HOME` plus the local mock model, and run `bun run test:codex`.
- Senpi/task: load `.agents/skills/senpi-qa/`, resolve its canonical evidence directory, run `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`, and run `bun run test:senpi`.

Never write to real user harness state during QA. Record what was tested, observed isolation, why coverage is sufficient, and what secret-bearing output was omitted.

## COMMANDS

```bash
bun install
bun test
bun run test:fast
bun run typecheck
bun run build
bun run test:codex
bun run test:senpi
bun run build:schema
```

Use Bun 1.4.0. The LSP tool packages are the narrow exception that use their package-local Node/npm workflows.

## DEVELOPMENT ENVIRONMENT

`script/agent/setup.sh` is the single source of truth for bootstrap; `script/agent/cleanup.sh` removes regenerable state, and `script/agent/cleanup-hook.sh` launches shutdown-safe Claude cleanup. `CLAUDE.md` points to this guide so both harnesses share the same contract.

Harness wiring delegates to those scripts: `.devcontainer/` covers Codespaces and Dev Containers, `.cursor/environment.json` covers Cursor, `.claude/settings.json` covers Claude Code, and `.codex/setup.sh` covers Codex App worktrees. Copy `.env.example` to an ignored `.env` for credentials. Source `script/agent/qa-sandbox.sh` before harness QA to isolate XDG and Codex state.

Keep setup scripts, harness wiring, this section, `CONTRIBUTING.md`, container documentation, and matching QA skills in sync whenever the toolchain or credential contract changes.

## CONVENTIONS

- Strict TypeScript, ESNext, bundler resolution, `bun-types`; no `as any`, `@ts-ignore`, or `@ts-expect-error`.
- Relative imports inside a module; barrel imports across modules; no `@/` aliases outside `packages/web/`.
- Kebab-case paths, `createXXX()` factories, barrel-only `index.ts`, and a 200-line soft limit.
- Co-locate Bun tests and use given/when/then structure. Async tests await exact events with bounded timeouts; fixed sleeps are forbidden.
- Pure prose has no automated-test seam. Do not pin prompt, skill, rule, `AGENTS.md`, or markdown wording in tests.
- Regenerate tracked artifacts from their sources; never hand-edit generated platform launchers or schemas.

## BLOCKING ANTI-PATTERNS

- No commits unless explicitly requested; no direct commits to `dev`; no squash or rebase merges.
- Never bypass red checks, weaken or skip failing tests, suppress diagnostics, or use `--admin` to merge.
- Never run `bun publish` directly or modify package versions locally.
- Never add runtime business logic to barrels or generic catch-all files.
- Never use empty catches, blind retries, fixed test sleeps, or raw secret-bearing QA logs.
- Never treat typecheck or unit tests alone as harness QA.

## CI AND RELEASE

PRs target `dev`; PRs targeting `master` are blocked. `ci.yml` runs tests, typecheck, builds, harness compatibility, package smoke, and schema freshness. Stable releases use `publish.yml`; Codex marketplace sync is automatic for stable releases. Merge PRs only with `gh pr merge <number> --merge --delete-branch` after checks, review-work, and Cubic pass.

## WHERE TO START

Read the nearest `AGENTS.md` before editing. For cross-package behavior, begin with `packages/AGENTS.md` and the owning adapter guide. For repository setup use `script/agent/setup.sh`; for cleanup use `script/agent/cleanup.sh`. When instructions conflict, the deeper guide wins unless the user explicitly overrides it.
