# tmux-utils — Pane/Session/Layout Primitives

**Generated:** 2026-08-24

**Score:** 17 (33 files, 2.4k LOC, own module boundary; not described in `shared/AGENTS.md` beyond one row)

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

- Barrel `index.ts` exports ONLY `killTmuxSessionIfExists`; everything else is consumed via direct file imports (notably `src/create-managers.ts` and `features/tmux-subagent/`).
- New tmux invocation goes into a `*-runner.ts` with injected spawn deps — never spawn `tmux` inside logic modules; the separation exists so logic stays unit-testable without a tmux binary.

## ANTI-PATTERNS

- NEVER call `tmux` directly from non-runner files.
- NEVER add a second ad-hoc sweep; extend `stale-*-sweep.ts` instead.
