# PR #6043 Integrated-Head QA

Date: 2026-07-17

## Exact Source

- Integrated head: `bc8007b6b1a6e26d8d522e5a2b2013694ebf1d34`
- Repair commit: `31c7eb1cbb810dd81aa4c7c29bd5b75e320ceaf1`
- Integrated `origin/dev`: `18c01bd5d41ba598b66539a76ad12bedd9a3459d`
- Merge base: `18c01bd5d41ba598b66539a76ad12bedd9a3459d`

The incoming base diff is confined to Senpi codegraph and task lifecycle work. It does not overlap the runtime-fallback repair.

## Automated Checks

- `runtime-fallback-suite.txt`: 341 pass, 0 fail, 687 expectations across 50 files.
- `shared-boundaries.txt`: 50 pass, 0 fail, 78 expectations across main-session lifecycle, session state, prompt-gate, and model-fallback boundaries.
- `static-gates-retry.txt`: repository-local no-excuse audit, Biome, OpenCode typecheck, and `git diff --check` passed.
- `source-identity.txt`: records the exact integrated head, base, and merge base.

The first `static-gates.txt` attempt used the user-level no-excuse helper, which crashes before analysis because its TypeScript module does not expose `ScriptTarget`. The repository-local copy is the authoritative project tool and passed in `static-gates-retry.txt`.

## Mandatory OpenCode QA

- `server-smoke.txt`: isolated authenticated server health and API checks passed.
- `sse-self-test.txt`: isolated SSE delivered `server.connected`.
- `tui-smoke.txt`: isolated tmux TUI rendered and accepted input; the real DB remained at 5,751 sessions.
- `live-harness-terminal.txt` and `live-isolation-receipt.txt`: the real plugin ran for production watchdog durations in isolated XDG directories. An older root fell back while two roots were active, deleting the newer root restored the older root, fallback-owned completion did not re-arm the watchdog, and a later user abort remained external.

## Senpi Qualification

Local `bun run test:senpi` built the new codegraph extension and LSP runtime, then stopped because the partial worktree did not contain the generated `packages/omo-senpi/plugin/skills/ultrawork` staging directory. The runtime-fallback repair does not touch this surface. The exact base commit's GitHub Senpi compatibility jobs passed on Ubuntu, macOS, and Windows; the repaired PR head must independently pass the same required jobs before merge. The local output is retained in `senpi-compatibility.txt` rather than presented as a pass.

## Isolation And Cleanup

- All OpenCode processes used isolated XDG data, config, state, and cache roots.
- The live sandbox created one session; the real DB count was unchanged.
- Raw server streams, raw plugin logs, generated passwords, and sandbox directories are omitted.
- Sanitized provider, watchdog, SSE, and root-state receipts contain no credentials.

## Conclusion

The repaired behavior and its adjacent boundaries pass on the current integrated tree. Cross-platform CI, Cubic, and five fresh exact-head review lanes remain required after the evidence commit is pushed.
