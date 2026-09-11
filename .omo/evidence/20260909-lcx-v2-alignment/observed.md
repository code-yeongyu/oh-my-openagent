# Observed

- The permitted-box rerun in `task-gate-d-remote-tests.log` reports `TEST_EXIT_a=1`, `TEST_EXIT_b=0`, `TEST_EXIT_c=0`, `TEST_EXIT_d=0`, and `TEST_EXIT_e=0`. Its same-machine `dev` comparison also reports the [a] failure, so [a] is PRE-EXISTING/ENV rather than branch-caused. The remote cleanup receipt confirms both temporary clones were removed.
- `build:codex-install` exited 0 and produced no porcelain status. The plugin build exited 0 and also produced no porcelain status.
- The installer self-test exited 0. It reported an isolated plugin cache, enabled marketplace plugin, 9 component bins, agent TOMLs, and an unchanged real `~/.codex/config.toml`.
- The D1 seeded install kept `gpt-5.6-terra` and `medium`, removed `agents.max_threads`, and preserved `max_concurrent_threads_per_session = 4`. The control kept `gpt-5.5`, `medium`, and `max_threads = 6` without the enabled flag. The dedicated fresh install check counted 12 isolated agent TOMLs.
- The source manifest count was 21 hooks. This agrees with the PR D spawn-guard manifest change described by `task-d3-doneclaim.json` and the implementation doneclaim `task-d1-doneclaim.json`.
- The app-server self-test returned `ok: true` and the mock assistant text. The plugin run returned `ok: true`, with non-empty raw summary records for `hook/started` and `hook/completed` for `sessionStart` and `userPromptSubmit`; the recorded hook list was not empty. See `app-server-plugin.log`.
- The raw ulw-loop spawn probe reported `RAW_SPAWN_EXIT=0` and `RAW_SPAWN_STDOUT_BYTES=0` for a clean session in a scratch cwd. See `raw-pipe-ulw-loop-spawn.log`.
- The ship-time digest before evidence commit was `b8a79c9c4660cbe4547bd4fa58aee5e1659c534d84967ebe2c163a5e43e22421` for `/Users/yeongyu/.codex/config.toml`. The final digest is recorded after shipping in this directory's `real-codex-config-sha-after-ship.txt`.
