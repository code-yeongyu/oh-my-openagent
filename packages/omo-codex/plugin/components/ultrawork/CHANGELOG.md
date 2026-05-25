# Changelog

## 0.1.0 — 2026-05-23

Initial release.

- Codex `UserPromptSubmit` hook (`hooks/ultrawork-detector.py`) that detects `ultrawork` / `ulw` (word-bounded, case-insensitive) in the user prompt and injects the ultrawork orchestration directive.
- Directive enforces: goal + binding success criteria with manual-QA scenarios + evidence, durable `/tmp` notepad lifecycle, obsessive atomic todos, scenario-driven execution loop, and a GPT-5.2 xhigh verification gate with no "false positive" escape hatch.
- Directive size: 5,775 chars across 143 lines.
