# Evidence: issue #5107 tmux visualization reporting

Date: 2026-09-02

Branch: `issue/5107-tmux-viz-skip-v481`

Audited base: `d79ea1ff88bb7436a44a91405f402ad828c7ebf4`

## What was tested

### Failing-first review regressions

1. Optional SDK configuration discovery:
   - a throwing primary `getConfig()` falls through to the session client;
   - two throwing accessors return no discovered URL;
   - `TmuxSessionManager` construction survives optional discovery failure.
2. Tmux layout transactions:
   - a later split failure removes panes already created by that attempt;
   - pane setup, layout, and resize failures clean only attempt-owned panes;
   - internal command errors are logged but the user receives a stable bounded reason.
3. Runtime and tool boundaries:
   - a stale `visualizationSkipReason` is removed when the current activation succeeds;
   - the real `team_create` tool serializes the exact machine-consumed skip-reason field.
4. Markdown evidence coverage:
   - the repository audit scans `.omo/` and `.opencode/` again without broad exclusions.

The reviewed head failed exactly at the missing behavior:

- URL discovery: `81 pass / 3 fail`;
- layout failure handling: `0 pass / 5 fail`;
- stale runtime reason: `35 pass / 1 fail`.

### Green automated gates

- Combined focused review suite: `168 pass / 0 fail / 453 expectations`.
- Full `team-core`: `167 pass / 1 skip / 0 fail / 380 expectations`, 29 files.
- OpenCode team-mode plus tmux-subagent suites: `469 pass / 1 skip / 0 fail / 1,186 expectations`, 62 files.
- Markdown-link audit: `16 pass / 0 fail / 21 expectations`.
- `team-core` and `omo-opencode` package typechecks: exit 0.
- Root plugin build: exit 0.
- Senpi compatibility gate: `2,531 pass / 7 skip / 0 fail / 8,070 expectations`, 334 files.
- Evidence-directory resolver: `10 pass / 0 fail / 31 expectations`.
- Senpi extension generation and independent freshness check: exit 0.

### Real OpenCode surface

OpenCode `1.18.26` was driven with isolated HOME and XDG data, config, state, and cache roots. The rebuilt local plugin was loaded through the real OpenCode plugin loader.

Observed behavior:

- noninteractive `opencode run --format json` returned the requested sentinel;
- authenticated server health returned `healthy=true`;
- OpenAPI exposed 162 documented paths;
- unauthenticated session access returned HTTP 401;
- `/experimental/tool/ids` exposed all 12 team tools, including `team_create`, `team_status`, and `team_list`;
- a controlled isolated CLI run left the real session count unchanged at 52 before and after;
- the real database contained zero sessions for the QA sandbox, while the isolated database contained seven QA sessions.

The actual `team_create` JSON response shape is covered by the integration test that drives `createTeamCreateTool` and parses its serialized output. The real server proof confirms that this rebuilt plugin registers that tool under enabled team mode.

## What was observed

- Optional server URL discovery is fail-closed. A broken SDK accessor cannot crash manager construction, and an independent fallback accessor can still recover the live URL.
- Pane creation is transactional. Every failure after pane creation performs best-effort cleanup of only the panes created by that attempt.
- Raw command exceptions remain in diagnostic logging. The runtime and serialized tool response expose only `tmux visualization unavailable: internal tmux operation failed`.
- The active runtime transition removes stale visualization state before applying the current activation result.
- Full markdown evidence coverage is restored; there is no directory-level audit escape hatch.
- Only the owned Senpi member and task bundles changed after regeneration. Unrelated generated Codex output was restored to the audited base.

## Why this is enough

The six review findings are pinned at their actual boundaries: external SDK access, tmux transaction ownership, user-visible error policy, runtime state replacement, tool serialization, and the repository markdown audit. The package suites cover sibling behavior, while the isolated OpenCode CLI and server prove that the built plugin loads and registers the full team tool surface without writing to the real database.

## What was omitted

- Live TUI rendering and a real tmux pane layout could not run because this host has no `tmux` executable. Both opt-in smoke commands stopped before product behavior with `Executable not found in $PATH: "tmux"`.
- The pane transaction itself is covered by injected command-runner tests that prove exact split, cleanup, layout, resize, and sanitization behavior.
- Raw logs, credentials, auth headers, environment dumps, and machine-local paths are not tracked.
