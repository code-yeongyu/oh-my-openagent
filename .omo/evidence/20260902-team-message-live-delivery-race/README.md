# Team live-delivery race fixture repair

## What changed

The Windows timeout came from the test fixture, not a proven delivery defect. The old fixture used the third test-local `loadRuntimeState` call to save a stale idle state and then await `pollAndBuildInjection`. That nested await calls `transitionRuntimeState`, which acquires the runtime `state.lock`, while the injected live-delivery state load remains unresolved. It provided no explicit completion signal, so the Windows shard could exhaust Bun's 5-second outer test deadline inside the fixture's lock/filesystem work.

The repaired fixture observes the real pre-reserved `.delivering-*.json` entry, starts the real mailbox transform without awaiting it, and returns the real runtime state. The mocked session status awaits that transform before reporting idle; the prompt callback then records the live delivery. The asserted order is reservation -> transform -> idle -> prompt. There are no fixed sleeps, polling loops, retries, skips, outer-timeout changes, or production changes.

PR #7643 is unrelated: it raised the Windows outer budget only for `generic fallback wakes cover two messages`, not this race.

## RED / GREEN

- **RED:** `red-reservation-mutation.txt` temporarily disabled `shouldReserveRecipientMailbox`. The test failed after its bounded event deadline waiting for the required `.delivering-*` reservation, proving the test detects the duplicate-delivery guard rather than accepting a timing delay.
- **GREEN:** `green-focused-race.txt` passed the exact test in 21.11ms with five assertions. It verifies the reserved filename, no transform injection, and the ordered reservation/transform/idle/prompt events.

## Automated verification

- `messaging-suite.txt`: complete messaging file: 41 pass, 0 fail.
- `team-mode-suite.txt`: team-mode, team mailbox, and state-store suites: 352 pass, 1 platform tmux skip, 0 fail.
- `package-typecheck.txt`, `root-typecheck.txt`, and `lsp-diagnostics.txt`: OpenCode package and root typechecks plus task-worktree TypeScript LSP diagnostics: all clean. The LSP artifact records its command, changed-file scope, bounded diagnostic event, and zero results.
- `root-build.txt`: root build passed. Generated Codex installer and Senpi extension churn was restored and excluded from the change.
- `opencode-qa-common.txt`, `opencode-isolation-probe.txt`, and `opencode-tui-smoke.txt`: isolated real OpenCode QA passed. Before TUI launch, `opencode db path` resolved to `<SANDBOX>/data/opencode/opencode.db` under the isolated XDG root. The TUI rendered under tmux, received input, cleaned up, and left the protected host database session count unchanged at 8047.

## Root test suite

`root-test.txt` records the required `bun test` run: 16988 pass, 15 skip, 7 fail. The changed messaging test passed. `root-test-baseline-unrelated-failures.txt` reproduces the same seven failures after restoring this test to `origin/dev`: one darwin embedded-manifest parity, one Codex installer embedded-version parity, and five skill-reader assertions polluted by the existing `<HOME>/.agents/skills` global configuration. They are pre-existing and unrelated to this test-only repair.

## Sanitization

Artifacts retain commands, concise test summaries, and isolation receipts only. They omit credentials, headers, environment dumps, database paths and rows, raw terminal capture, raw stack traces, generated source, and host-specific paths.
