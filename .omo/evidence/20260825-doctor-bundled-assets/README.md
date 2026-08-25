# 20260825-doctor-bundled-assets

WHAT WAS TESTED
- Unit suite for the bundled-assets doctor check (pass/fail/skip semantics).
- Full doctor module regression after registration.
- Real `doctor --json` CLI from source in an isolated XDG sandbox with an incomplete cache install, then remediated.
- Real OpenCode (installed binary) loading the locally built dist/index.js via a file:// plugin entry under an isolated XDG sandbox; agent registration observed over GET /agent.

OBSERVED RESULT
- unit: 4 pass / 0 fail (unit-bundled-assets.txt)
- doctor suite: 174 pass / 0 fail across 28 files (doctor-suite.txt)
- CLI drive incomplete cache: BUNDLED ASSETS check fails with absolute missing path + reinstall fix (cli-drive-incomplete-cache.json); complete cache passes (cli-drive-complete-cache.json)
- file:// load into real OpenCode: GET /agent returns 17 agents including Sisyphus - ultraworker, Hephaestus, Prometheus, Atlas, Sisyphus-Junior, oracle (opencode-file-load-agents.json)

WHY IT IS SUFFICIENT
- Covers manifest semantics (unit), no-regression across doctor (suite), end-to-end user-facing behavior before/after remediation (CLI drive), and real-harness load of the built artifact (file:// drive).

WHAT WAS OMITTED
- No raw secrets, env dumps, tokens, or auth headers captured; sandbox configs are synthetic.
- Host ~/.config/opencode and ~/.codex untouched; isolated XDG dirs only; running user instance not disturbed.
- Full-repo bun run typecheck / bun test blocked by environment: @code-yeongyu/senpi@2026.8.23 returns 404 from npm (pre-existing, unrelated paths); remaining full-suite failures are senpi-task/omo-senpi module-resolution plus network-dependent registry cases; zero failures reference doctor or bundled-assets.
