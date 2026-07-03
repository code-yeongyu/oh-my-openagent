# Security Pipeline Agents QA Evidence

## What Was Tested

- Focused Bun tests for the new agent factories, permissions, model fallback requirements, config schema, display-name mapping, shared migration map, and team-mode eligibility.
  - Artifact: `focused-tests.txt`
- TypeScript typecheck across the repo workspaces.
  - Artifact: `typecheck.txt`
- Full package build, including bundled plugin output, Codex install bundle, and JSON schema generation.
  - Artifact: `build.txt`
- OpenCode real-harness registration with an isolated XDG sandbox and local plugin entry `file://<worktree>/dist/index.js`; queried `GET /agent` and asserted all six new security agents were exposed.
  - Artifacts: `opencode-agent-registration-summary.txt`, `opencode-agents.json`, `opencode-agent-names.txt`, `opencode-server.log`
- Codex isolated install verification because the generated Codex installer bundle includes the shared migration-map update.
  - Artifact: `codex-install-verify.txt`
- Codex first-party app-server run with the local plugin and local mock model; asserted plugin hook completions for `sessionStart` and `userPromptSubmit`.
  - Artifact: `codex-app-server-drive.json`
- Codex compatibility gate.
  - Artifact: `test-codex.txt`

## What Was Observed

- Focused tests: 189 pass, 0 fail.
- Typecheck: `bun run typecheck` completed successfully.
- Build: `bun run build` completed successfully and regenerated `assets/oh-my-opencode.schema.json`.
- OpenCode: a real isolated server loaded the local plugin and `/agent` contained `Security Orchestrator`, `Security Recon`, `Security Scanner`, `Security Validator`, `Security Deduper`, and `Security Prover`.
- OpenCode isolation: real DB session count stayed `11403` before and after the isolated server QA.
- Codex install verification: local `omo` installed in isolated `CODEX_HOME`, enabled `omo@sisyphuslabs`, linked component bins and agent TOMLs, and left real `~/.codex/config.toml` unchanged.
- Codex app-server: local plugin hooks fired and completed for `sessionStart` and `userPromptSubmit`; the turn completed against the mock model without a real API call.
- `bun run test:codex`: 456 pass, 0 fail.

## Why It Is Enough

- The focused tests cover the source-level behavior added by this change: agent prompts and permissions, schema acceptance, model fallback chains, display names, team-mode hard-reject handling, and shared migration aliases.
- The OpenCode server QA proves the compiled local plugin exposes the new agents through OpenCode's real `/agent` API, not just through unit tests.
- The Codex install and app-server QA cover the generated Codex installer bundle touched by the shared utility change and prove the real Codex plugin still installs and fires hooks in isolation.
- Typecheck, build, and `test:codex` cover cross-package TypeScript, bundled artifact, schema, and Codex regression surfaces.

## What Was Omitted

- No live security target was scanned or probed; this change only adds agent definitions and design guidance.
- No real model API was called; Codex QA used the local mock model, and OpenCode QA only queried agent registration.
- Raw secrets, auth headers, tokens, and env dumps were not captured. Evidence contains only ephemeral sandbox paths, local file paths, and generated QA output.
