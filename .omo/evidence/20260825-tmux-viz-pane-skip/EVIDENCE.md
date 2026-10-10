# Evidence — Issue #3963: tmux_visualization silently skips pane creation (port-0 discard)

Date: 2026-08-25 | Branch: issue/3963-tmux-viz-pane-skip | Base: c7094b8ac

## WHAT WAS TESTED

1. Failing-first regression suite (bun test), co-located given/when/then:
   - `packages/omo-opencode/src/features/tmux-subagent/resolve-server-url.test.ts` (new):
     `ctx.serverUrl = http://127.0.0.1:0/` + SDK-discovered real base URL → discovered URL wins;
     port-0 without discovery keeps OPENCODE_PORT / :4096 fallback; unusable discovered URL
     (port 0 too) still falls back; non-zero-port advertised URL unchanged; undefined
     serverUrl behavior pinned unchanged (#5107 lane boundary).
2. Blast radius: co-located `manager.test.ts` (constructor wiring through
   `getServerBaseUrl(client)`), full `packages/team-core/src/team-layout-tmux/`,
   `team-runtime/create.test.ts` + `activate-team-layout.test.ts`.
3. Typecheck gate: `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`.

## WHAT WAS OBSERVED

- RED first: new test failed with `Expected "http://127.0.0.1:50946" Received "http://localhost:4096"`
  — exactly the reported discard of a valid discovered URL for the hardcoded fallback.
- GREEN after fix:
  - Scoped run (resolve-server-url + manager): 78 pass / 0 fail (228 expect()).
  - Wide run (team-core layout suite + create/activate): 56 pass / 1 pre-existing skip / 0 fail.
  - `tsgo --noEmit` on packages/omo-opencode: exit 0.
- Fix seam: `resolveServerUrl()` gained an optional `discoveredUrl` parameter used ONLY in the
  `port === '0'` branch; `TmuxSessionManager` constructor passes `getServerBaseUrl(this.client)`
  (`shared/opencode-http-api.ts`). Default TUI launch (`--port 0`, ephemeral bind) now resolves
  the real bound URL, so `createTeamLayout`'s `isServerRunning` gate can pass and panes spawn.

## WHY IT IS ENOUGH

- The maintainer-confirmed root cause (issue comment: resolve-server-url.ts:18-26 discards the
  real URL when port is '0') is pinned by a deterministic unit seam at the exact discard point;
  no network or live tmux needed. All downstream consumers (manager → getServerUrl →
  createTeamLayout isServerRunning) are covered by the untouched existing suites staying green.
- Sibling lane respected: PR #7291 (#5107) owns undefined-serverUrl recovery + skip-reason
  surfacing; this change does not alter that path (pinned by test) and touches neither
  layout.ts nor activate-team-layout.ts, so both PRs remain semantically orthogonal.

## WHAT WAS OMITTED

- Live opencode-in-tmux manual repro (needs desktop tmux + real model session); covered by the
  deterministic unit chain above plus green downstream suites. Residual risk: SDK client shapes
  exposing no baseUrl fall back to today's OPENCODE_PORT/:4096 behavior (unchanged, warning kept).
- Out of scope per issue triage: `team_delete.removedLayout` semantics (option C) — separate
  cleanup-report logic, explicitly left to maintainer decision.
- No secrets involved; no env dumps collected.
