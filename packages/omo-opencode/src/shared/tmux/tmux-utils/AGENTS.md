# tmux-utils — Pane/Session/Layout Primitives

**Generated:** 2026-08-24

**Score:** 17 (42 files, 2.9k LOC, own module boundary; direct tmux implementation is now largely delegated to `@oh-my-opencode/tmux-core`)

## OVERVIEW

Tmux pane/session/window/layout utilities under `shared/tmux/`. Pure decision logic is separated from process execution: `*-runner.ts` modules perform the actual tmux invocation behind injectable spawn deps (`adapter-deps.ts`, `spawn-process.ts`), so the logic modules stay unit-testable.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Panes | `pane-spawn.ts` (+`pane-spawn-runner.ts`), `pane-close.ts` (+runner), `pane-replace.ts`, `pane-activate.ts`, `pane-command.ts`, `pane-dimensions.ts` |
| Sessions / windows | `session-spawn.ts`, `session-kill.ts` (+`session-kill-runner.ts`; barrel exports `killTmuxSessionIfExists`), `window-spawn.ts` |
| Layout | `layout.ts` + `layout-runner.ts` |
| Health / environment | `server-health.ts`, `environment.ts` |
| Spawn injection | `adapter-deps.ts` (injectable deps), `spawn-process.ts` |
| Stale-resource sweeps | `stale-session-sweep.ts` (+`stale-session-sweep-runtime.test.ts`), `stale-attach-pane-sweep.ts` |

## CONVENTIONS

- Nested `index.ts` exports ONLY `killTmuxSessionIfExists`; the top-level `tmux-utils.ts` remains the broader direct-import facade. Most implementation modules adapt `@oh-my-opencode/tmux-core` and retain injectable deps for tests.
- New tmux invocation goes into a `*-runner.ts` with injected spawn deps — never spawn `tmux` inside logic modules; the separation exists so logic stays unit-testable without a tmux binary.

## ANTI-PATTERNS

- NEVER call `tmux` directly from non-runner files.
- NEVER add a second ad-hoc sweep; extend `stale-*-sweep.ts` instead.
