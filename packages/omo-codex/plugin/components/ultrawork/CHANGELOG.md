# Changelog

## Unreleased

- Runtime hook migrated from `python3 hooks/ultrawork-detector.py` to the component-standard TypeScript build output `node dist/cli.js hook user-prompt-submit`, removing the Codex runtime dependency on Python.
- New top-level **`# Manual-QA channels`** section explicitly enumerates the four real-usage channels the agent MUST verify through: (1) HTTP call, (2) tmux, (3) Browser use, (4) Computer use — each with concrete commands and the artifact to capture. Auxiliary surfaces (CLI stdout / DB diff / parsed config dump) only count for genuinely CLI- or data-shaped criteria.
- Goal section now shouts **TESTS ALONE NEVER PROVE DONE**: a green test suite is supporting evidence, never completion proof. Every criterion needs its own real-usage scenario, built fresh and run through one of the four channels, every time.
- Bootstrap criterion item 2 and execution step 4 collapse onto the new channel table to remove triple-enumeration of the same surfaces (single source of truth, less drift).
- Execution loop step 4 (**SURFACE-AS-SCENARIO**) runs the chosen channel scenario; step 5 (**CLEANUP, PAIRED**) tears down server PIDs, `tmux` sessions, browser / Playwright contexts, containers, bound ports, temp files / dirs, QA-only env vars and records a one-line receipt. Missing receipt → criterion stays in_progress. Leftover state from QA = NOT done (Stop rule).
- Regression tests in `test/codex-hook.test.ts` now pin: the four channel labels (`HTTP call`, `tmux`, `Browser use`, `Computer use`), `TESTS ALONE NEVER PROVE DONE`, `every criterion needs its own real-usage scenario`, the `# Manual-QA channels` heading, plus SURFACE-AS-SCENARIO + CLEANUP + leftover-state stop rule.
- Directive size: 10,951 chars across 231 lines.

### Pre-cleanup unreleased entries (folded above)

- Execution loop mandated **SURFACE-AS-SCENARIO** manual QA — the agent must actually invoke the real surface (HTTP via `curl -i`, terminal / TUI via `tmux new-session` + `send-keys` + `capture-pane`, GUI via computer-use / Playwright, CLI stdout, DB diff). `--dry-run` and "looks correct" no longer count.
- Paired **CLEANUP** step requires teardown of every QA-spawned runtime artifact with a one-line cleanup receipt recorded in the notepad. Missing receipt → criterion stays in_progress.
- Stop rule: leftover state from QA (live process, `tmux` session, browser context, bound port, temp dir) means NOT done.

## 0.1.0 — 2026-05-23

Initial release.

- Codex `UserPromptSubmit` hook that detects `ultrawork` / `ulw` (word-bounded, case-insensitive) in the user prompt and injects the ultrawork orchestration directive.
- Directive enforces: goal + binding success criteria with manual-QA scenarios + evidence, durable `/tmp` notepad lifecycle, obsessive atomic todos, scenario-driven execution loop, and a ChatGPT-compatible xhigh verification gate with no "false positive" escape hatch.
- Directive size: 5,775 chars across 143 lines.
