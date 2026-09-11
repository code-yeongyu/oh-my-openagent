# What was tested

This PR D ship check covered the prepared branch `lcx/v2-enabled-alignment` at `fd6d546ea2dbabea0d28b8fc4be56a3da3a407ad`.

- Read the permitted-box rerun in `task-gate-d-remote-tests.log`. The final section records [a]-[e] with [a] classified PRE-EXISTING/ENV because the matching `dev` run failed with the same Linux gorky bun-absent wrapper behavior; [b], [c], [d], and [e] exited 0.
- Ran `bun run build:codex-install`; the generated installer left `git status --porcelain` empty. The successful build transcript is `build-codex-install.log` and the empty status is `status-after-codex-install-build.log`.
- Ran the plugin build from `packages/omo-codex/plugin` with `bun run build`; it exited 0 and left no repository changes. The transcript is `plugin-build.log` and the status is `status-after-plugin-build.log`.
- Ran `install-verify.sh --self-test` from the codex-qa skill. The isolated install found the plugin cache, enabled `omo@sisyphuslabs`, linked component bins and agent TOMLs, and preserved the real config digest.
- Ran a fresh isolated install with a D1 seeded configuration: `model = "gpt-5.6-terra"`, reasoning effort `medium`, `[features.multi_agent_v2] enabled = true`, `max_concurrent_threads_per_session = 4`, and `[agents] max_threads = 6`. Also ran a control with `gpt-5.5`, no enabled flag, and `max_threads = 6`.
- Verified the source manifest with `jq '.hooks|length' packages/omo-codex/plugin/.codex-plugin/plugin.json` and verified the isolated installed agent count.
- Ran `app-server-drive.sh --self-test` first, then `app-server-drive.sh --plugin --expect sessionStart,userPromptSubmit` using the local mock model. The app-server summary includes hook started/completed records.
- Piped a complete PreToolUse payload for `spawn_agent` to the installed ulw-loop CLI in a clean scratch cwd and session. The clean allow path exited 0 and emitted zero stdout bytes.
- Captured the ship-time real config digest in `real-codex-config-sha-before-ship.txt`; each codex-qa driver also performed its own before/after real-home assertion.

The exact command outputs are retained in this evidence directory. Existing implementation records are `task-d1-doneclaim.json` and `task-d3-doneclaim.json`.
