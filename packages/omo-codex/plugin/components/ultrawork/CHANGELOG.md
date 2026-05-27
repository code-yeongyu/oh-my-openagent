# Changelog

## Unreleased

- Execution loop now mandates **SURFACE-AS-SCENARIO** manual QA — the agent must actually invoke the real surface (HTTP via `curl -i`, terminal / TUI via `tmux new-session` + `send-keys` + `capture-pane`, GUI via computer-use / Playwright, CLI stdout, DB diff). `--dry-run` and "looks correct" no longer count.
- New paired **CLEANUP** step requires teardown of every QA-spawned runtime artifact (server PIDs, `tmux` sessions, browser / Playwright contexts, containers, bound ports, temp files / dirs, QA-only env vars) with a one-line cleanup receipt recorded in the notepad. Missing receipt → criterion stays in_progress.
- New Stop rule: leftover state from QA (live process, `tmux` session, browser context, bound port, temp dir) means NOT done.
- Regression tests in `hooks/ultrawork-hooks.test.mjs` pin the SURFACE-AS-SCENARIO + CLEANUP mandates so they cannot be silently regressed.
- Directive size: 10,037 chars across 213 lines.

## 0.1.0 — 2026-05-23

Initial release.

- Codex `UserPromptSubmit` hook (`hooks/ultrawork-detector.py`) that detects `ultrawork` / `ulw` (word-bounded, case-insensitive) in the user prompt and injects the ultrawork orchestration directive.
- Directive enforces: goal + binding success criteria with manual-QA scenarios + evidence, durable `/tmp` notepad lifecycle, obsessive atomic todos, scenario-driven execution loop, and a GPT-5.2 xhigh verification gate with no "false positive" escape hatch.
- Directive size: 5,775 chars across 143 lines.
