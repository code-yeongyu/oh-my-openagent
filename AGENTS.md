# oh-my-openagent Repository Guide

> The multi-harness package-layering refactor is active. Read [`ROADMAP.md`](ROADMAP.md) before changing architecture. Treat executable sources, manifests, tests, and workflows as authoritative when prose disagrees.

## Start Here

- Read the nearest `AGENTS.md` before editing. Nested instructions override this root guide for their subtree.
- Use [`packages/AGENTS.md`](packages/AGENTS.md) to locate package roles and publication boundaries.
- OpenCode adapter work: [`packages/omo-opencode/src/AGENTS.md`](packages/omo-opencode/src/AGENTS.md).
- Codex adapter and installer work: [`packages/omo-codex/AGENTS.md`](packages/omo-codex/AGENTS.md).
- Senpi adapter work: [`packages/omo-senpi/AGENTS.md`](packages/omo-senpi/AGENTS.md).
- Native `omo-ai` launcher work: [`packages/omo-native/AGENTS.md`](packages/omo-native/AGENTS.md).
- Build/release automation: [`script/AGENTS.md`](script/AGENTS.md). Repo integration tests: [`tests/AGENTS.md`](tests/AGENTS.md). Skills and commands: [`.agents/AGENTS.md`](.agents/AGENTS.md).
- Do not copy volatile package, hook, tool, or component counts into this file. Inspect the current manifest and implementation.

## Architecture Boundaries

- The intended dependency direction is adapters toward harness-neutral Core, MCP, and Skills packages. Platform launchers and Web are leaves. Preserve the documented transitional exceptions in `ROADMAP.md`; do not create new reverse edges.
- `packages/omo-opencode/`, `packages/omo-codex/`, and `packages/omo-senpi/` are separate harness adapters. Do not assume feature, tool, config, install, or distribution parity across them.
- `packages/omo-native/` is the native `omo-ai` distribution adapter; keep launcher and canonical agent-directory behavior there rather than treating it as Core.
- Harness-neutral packages must not import OpenCode, Codex, Senpi, or Pi runtime APIs. Keep harness glue in its adapter.
- `packages/senpi-task/` is Senpi-coupled adapter support, not a Core package.
- `packages/pi-goal/` and `packages/pi-webfetch/` are standalone Pi adapters; they are not automatically wired into other editions.
- `packages/web/` is an independent app with its own toolchain and CI. Root `bun test` excludes it.
- Platform launcher packages are generated. Change `script/build-binaries.ts`, never their generated launcher files.
- Generated Codex and Senpi plugin artifacts must be changed through their source/build scripts, not edited in place. Read the adapter guide first.

## INITIALIZATION FLOW

Despite its directory name, `packages/omo-opencode/src/testing/create-plugin-module.ts` contains production initialization. Its `serverPlugin()` owns the staged flow: startup shims and config context, conflict/auth/config setup, runtime integrations, managers/tools/hooks/interface composition, then compaction and disposal wiring. Treat `serverPlugin()` as the sole ordering authority; the adapter's [`INITIALIZATION (7 STEPS)`](packages/omo-opencode/src/AGENTS.md#initialization-7-steps) section is orientation only, while [`src/testing/AGENTS.md`](packages/omo-opencode/src/testing/AGENTS.md) documents the DI and testing constraints.

## High-Risk Invariants

Instruction files are prompt context, not deterministic permission boundaries. Put hard boundaries in OMO permissions, tool allowlists, host permission gates, repository protections, and review gates; OMO does not consume `AGENTOWNERS.yml`. See [`docs/reference/features.md`](docs/reference/features.md#instruction-files-vs-enforcement).

### Internal message injection is dangerous

- Treat `session.prompt` and `session.promptAsync` as writes to shared OpenCode session state. Production calls belong only in `packages/omo-opencode/src/shared/prompt-async-gate.ts`; other routes must use `dispatchInternalPrompt` or the established gate abstraction.
- New internal-prompt routes need route-specific duplicate-dispatch tests. Never use a zero post-dispatch hold or a raw-prompt fallback when session identity is absent.
- Core package extraction is behavior-preserving: move implementation into Core, leave adapter-facing shims where stable imports require them, verify, then remove duplicates.
- Do not introduce a cross-harness abstraction for speculative future parity. `ROADMAP.md` explicitly prefers direct adapters while harness APIs remain unstable.
- Do not add a package without a justified runtime or ownership boundary; package registration and dependency direction are audited.

## Change Workflow

Every user-ordered repository patch follows this sequence:

1. Explore the real files and callers; never patch from memory.
2. Write a decision-complete plan under `.omo/plans/` and mirror atomic work in the todo list.
3. Implement in a task-owned git worktree, never directly on `dev`.
4. Add a failing behavior test first when a behavioral seam exists. Pure prose changes use review and read-through QA, not phrase-pin tests.
5. Run focused checks, then the relevant full gates and real harness QA.
6. Record reviewer-readable, sanitized evidence under `.omo/evidence/<YYYYMMDD>-<slug>/` before commit or push.
7. Open a PR against `dev`, resolve failures and review, and merge with a merge commit. Never squash-merge or rebase-merge this repository.

Do not commit, push, publish, or modify shared infrastructure unless the user authorized the external side effect. Never force-push, amend, or use destructive git recovery without explicit approval.

## STOP. QA IS MANDATORY

Typechecks and unit tests are necessary but do not prove harness behavior.

- OpenCode-connected changes must use the `opencode-qa` skill and an isolated XDG sandbox. Never QA against the real OpenCode database. Prove the changed tool, hook, CLI, or runtime path through structured OpenCode events or the server API; tmux is only a TUI smoke surface.
- Codex-connected changes must use the `codex-qa` skill with an isolated `CODEX_HOME`, the local build, and a local mock model. Never QA against the published package or real `~/.codex`; prove relevant `hook/started` and `hook/completed` events.
- Senpi-connected changes under `packages/omo-senpi/` or `packages/senpi-task/` must use the `senpi-qa` skill. Resolve live evidence only with `.agents/skills/senpi-qa/scripts/resolve-evidence-dir.mjs`, run `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` and `bun run test:senpi`, then use the isolated real-Senpi drivers documented by the skill.
- A cross-adapter change runs every affected adapter's QA. Unit-only evidence is insufficient for live behavior claims.
- Each evidence directory must state what was tested, what behavior it proves, what was observed, why coverage is sufficient, isolation proof, residual risk, and what secret-bearing material was omitted or redacted.

No evidence file means no harness QA and therefore no commit or push for a harness-connected change.

## CODEX LIGHT EDITION

`packages/omo-codex/` is the Codex Light adapter. The live npm package/bin is `lazycodex-ai`; `lazycodex` is a root-bin and repository identity, not an npm package; Codex sees marketplace `sisyphuslabs` and plugin `omo` as `omo@sisyphuslabs`. The main package also exposes `omo-agent-toolkit`; bare `omo` belongs to the beta native `omo-ai` package, not this package family. Keep implementation detail in [`packages/omo-codex/AGENTS.md`](packages/omo-codex/AGENTS.md). `.github/workflows/publish.yml` controls the npm alias through `publish_lazycodex` and syncs the marketplace repository only when `dist_tag == ''` (a stable release).

## Tests And Commands

Use Bun from the repository root unless a nested guide identifies a vendored Node-targeted package. Do not replace repository commands with npm, yarn, or pnpm equivalents.

```bash
bun test <path>       # narrowest relevant Bun test
bun test              # root suite, one process, with test-setup.ts preload
bun run typecheck     # root, scripts, and workspace package typechecks
bun run build         # main distribution build
bun run test:codex    # full Codex compatibility gate
bun run test:senpi    # Senpi build, typecheck, and package tests
```

- Locally, `bun test` runs configured root discovery including `packages/omo-senpi/**`. Non-Windows root-test CI runs one `bun --config=bunfig.root.toml test` pass, which excludes that adapter; Windows CI intentionally partitions the root tests as declared in `.github/workflows/ci.yml`. Do not invent additional ordering, retries, `.only`, `.skip`, or process isolation to hide state leaks.
- `test-setup.ts` creates a hermetic HOME, resets shared state, and may build missing vendored LSP output. Account for that before diagnosing environment-dependent failures.
- `bunfig.toml` excludes Web, vendored LSP projects, Codex plugin suites, generated scripts, and upstream skill trees. Run their declared package or CI commands when touched.
- Event tests subscribe before triggering and use timeouts only as circuit breakers. Do not synchronize tests with arbitrary sleeps.
- Prompt and prose contract tests are forbidden. For authored Markdown and instruction text, use review and read-through QA unless a machine-consumed sentinel, shipped-copy equality, parser contract, or observable runtime behavior provides a real test seam.
- Use given/when/then comments or describe labels in tests; do not use Arrange-Act-Assert comments.

## Code And Generation Rules

- TypeScript is strict. Never use `as any`, `@ts-ignore`, `@ts-expect-error`, empty catches, or suppressed diagnostics.
- Follow local module patterns. Package `src/` code uses relative imports within a module and barrels across module boundaries; `packages/web/` is the path-alias exception.
- Keep business logic out of barrel `index.ts` files. Do not create generic catch-all modules such as `helpers.ts`, `utils.ts`, or `service.ts`.
- Add comments only for non-obvious constraints. Do not delete or weaken failing tests to make a gate pass.
- Regenerate schemas, platform launchers, plugin bundles, skills, and other derived artifacts through the owning scripts. Include required generated changes in the same patch.
- Never change package versions or run `bun publish` locally. Releases are owned by GitHub Actions.

## DEVELOPMENT ENVIRONMENT

`script/agent/setup.sh` is the single source of truth for bootstrap. `script/agent/cleanup.sh` removes regenerable state; `script/agent/cleanup-hook.sh` is the non-blocking Claude shutdown launcher. `.env.example` is the credential template. `script/agent/qa-sandbox.sh` creates throwaway XDG and `CODEX_HOME` state for QA.

For the branded `omo-ai` distribution, `canonicalAgentDir()` owns the `~/.omo/agent` default. Senpi's compatibility resolver gives `OMO_CODING_AGENT_DIR`, `SENPI_CODING_AGENT_DIR`, then `PI_CODING_AGENT_DIR` precedence; absent an override, it detects `settings.json` under `~/.omo/agent`, then flat `~/.omo`, and otherwise uses `~/.senpi/agent`. Do not compose another default. The spawned engine, `omo doctor`, `omo setup`, local launcher, and installer must all use the canonical resolver.

Committed harness wiring delegates to that shared setup:

- Codespaces and Dev Containers: `.devcontainer/`
- Cursor cloud agents: `.cursor/environment.json`
- Claude Code lifecycle: `.claude/settings.json`
- Codex App worktrees: `.codex/setup.sh`
- Claude instructions: `CLAUDE.md`, which must remain a symlink to this file

When setup dependencies, environment variables, harness wiring, or isolation behavior change, keep `script/agent/setup.sh`, cleanup scripts, `script/agent/qa-sandbox.sh`, this section, the matching `CONTRIBUTING.md` and `.devcontainer/README.md` sections, and the matching skill in sync. Keep `script/agent-env.test.ts`, `script/agent-harness-wiring.test.ts`, and `script/agents-md-dev-env.test.ts` green.

## Git And Release Policy

- PRs target `dev`; PRs targeting `master` are blocked.
- Required merge strategy is a merge commit after CI, review-work, and Cubic pass.
- Never use `gh pr merge --admin` or any required-check override. A red required check on `dev` is still a merge blocker: fix the base defect, update the branch, and rerun the gate rather than weakening, skipping, retry-masking, or excluding the test.
- Use GitHub Actions for publishing and platform artifacts. Never manually publish sibling packages.
- `script/` is Bun/TypeScript build and release automation; `scripts/` contains Node helpers. Do not confuse the two paths.
- Before handoff, inspect `git diff --check`, the complete diff, and `git status`; stage only intended files and never include credentials or raw secret-bearing QA logs.
