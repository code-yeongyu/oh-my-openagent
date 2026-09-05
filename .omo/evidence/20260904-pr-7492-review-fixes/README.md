# PR 7492 config diagnostic review-fix QA

## What was tested

- Added failing-first tests for profile-scoped category hints and Desktop-only
  OpenCode config discovery.
- Ran the focused config-directory and plugin-factory suites with Bun 1.4.0.
- Ran the OpenCode adapter typecheck and complete plugin build.
- Self-tested the `opencode-qa` common sandbox and SSE probe.
- Drove the real `opencode debug config --print-logs` command twice:
  - with categories only in the macOS Desktop Tauri config;
  - with `OPENCODE_CONFIG_DIR` pointing to `profiles/focused`.
- Set isolated HOME and all XDG roots for both real OpenCode runs and compared
  the real OpenCode database session count before and after.
- Linked the original issue evidence to this reviewer-repeatable capture set.

## What was observed

- Before implementation, the new suite failed because the discovery helper
  did not exist, the profile warning pointed only to `~/.omo/omo.jsonc`, and
  the Desktop-only config produced no warning.
- After implementation: 49 pass, 0 fail, 82 assertions.
- OpenCode adapter typecheck: exit 0.
- Full plugin build: exit 0.
- `opencode-qa` common self-check and SSE self-test: pass.
- Real Desktop run printed the exact ignored-category source under
  `<desktop-config>/opencode.jsonc`.
- Real profile run pointed to
  `~/.omo/omo.jsonc under profiles.focused.categories`.
- Both real runs exited zero.
- The real OpenCode database contained 8072 sessions before and after each
  run.
- After merging `upstream/dev@0a5dab201`, the 49 focused tests, adapter
  typecheck, full build, both real warning scenarios, and both database
  isolation checks passed again.
- A follow-up real OpenCode run recorded the sandbox path relationship:
  `XDG_DATA_HOME=<sandbox>/data` and
  `opencode db path=<sandbox>/data/opencode/opencode.db`. The sandbox database
  contained 0 sessions and the real database remained 8072 before and after.
  See `isolation-provenance.txt`.
- The final review follow-up added exact discovery for `OPENCODE_CONFIG`,
  every ancestor's `opencode.json(c)` and `.opencode/opencode.json(c)`,
  Windows `%APPDATA%/opencode`, and every simultaneous misplaced source.
  Failing-first results and final counts are recorded in
  `discovery-followup.txt`.
- Final focused discovery suites: 53 pass, 0 fail, 89 assertions.
- Final related startup and configuration suites: 212 pass, 0 fail,
  462 assertions across 24 files.
- Adapter typecheck, full build, OpenCode QA common self-check, SSE self-test,
  and the real isolated warning run all passed.
- After merging `dev@07e30350b`, the 212 related tests, adapter typecheck,
  full build, and real isolated warning run passed again. The sandbox database
  remained under its XDG data root with 0 sessions, and the real database
  remained 8072 before and after.
- Late review follow-up covered inline `OPENCODE_CONFIG_CONTENT`, lexical
  profile recovery through a symlink, and OpenCode-only profile targeting.
  All three regressions failed first, then passed with 4 assertions.
- Final related diagnostics suites passed 60 tests with 0 failures and 97
  assertions. Adapter typecheck, full build, the OpenCode QA common helper,
  and SSE self-test passed.
- Real isolated OpenCode runs diagnosed both the inline source and the active
  profile source. The profile hint now targets
  `profiles.focused."[opencode]".categories`; both runs exited zero. Each receipt
  records its tested commit, capture ID, UTC timestamp, driver, runner,
  resolved HOME and database path, explicit sandbox-containment assertions,
  zero isolated sessions, and the real database unchanged at 8072 sessions.
  See `late-review-followup.txt`.
- Final review exposed one test-boundary leak: unrelated plugin-factory tests
  could invoke the production scanner against inherited host OpenCode paths.
  A deterministic host-config fixture failed first at 22 pass and 1 fail.
- The scanner is now a `PluginModuleDeps` dependency. The shared test factory
  supplies an empty stub, while the diagnostic suite explicitly forwards the
  production scanner. Focused suites passed 26 tests with 0 failures and 59
  assertions; adapter typecheck, full build, and QA helper self-tests passed.
- A final real OpenCode run exercised the production default dependency,
  emitted the inline warning, resolved HOME and its database below the
  sandbox, recorded zero isolated sessions, and left the real database
  unchanged at 8072. See `hermetic-scanner-followup.txt`.
- Final home-boundary review failed first at 4 pass and 1 fail because the
  scanner walked above HOME. The corrected focused suites passed 28 tests
  with 0 failures and 62 assertions, including project-inside-HOME and
  project-outside-HOME behavior. Adapter typecheck, full build, and QA helper
  checks passed.
- A real OpenCode run loaded the built plugin for a project below an isolated
  HOME while a misplaced config existed immediately above HOME. The
  unresolvable warning remained absent, the isolated database stayed empty,
  and the real database remained 8072 before and after. See
  `home-boundary-followup.txt`.
- Existing-destination review failed first at 5 pass and 2 fail because both
  user and project hints always named `omo.jsonc`. The corrected focused
  suites passed 30 tests with 0 failures and 66 assertions. Adapter typecheck,
  full build, and QA helper checks passed.
- A real OpenCode run with only `~/.omo/omo.json` present emitted an inline
  diagnostic targeting that active JSON file, not a new JSONC file. The
  isolated database remained empty and the real database stayed at 8072
  sessions. See `json-target-followup.txt`.
- Project-symlink review failed first at 7 pass and 2 fail because diagnostics
  targeted files the unified loader rejects. The corrected focused suites
  passed 32 tests with 0 failures and 69 assertions. A symlinked project
  config now selects a loadable sibling; a symlinked `.omo` directory names
  the replacement prerequisite explicitly.
- Adapter typecheck, full build, QA helper checks, and a final real OpenCode
  warning run passed. The sandbox database remained empty and the real
  database stayed at 8072 sessions. See `symlink-target-followup.txt`.
- Scope-precedence review failed first at 9 pass and 2 fail: an overlapping
  `OPENCODE_CONFIG_DIR` kept its user target, and the HOME boundary used
  project symlink rules. The corrected scanner reconciles canonical duplicate
  sources in favor of project scope and treats both configured HOME and the
  account home as user boundaries.
- A proactive dual-home parity case failed first at 11 pass and 1 fail, then
  the complete focused suites passed 35 tests with 0 failures and 77
  assertions. Adapter typecheck, full build, and QA helper checks passed.
- A real OpenCode run with `OPENCODE_CONFIG_DIR=<project>/.opencode` emitted
  exactly one warning targeting `<project>/.omo/omo.jsonc`, not the user
  layer. The sandbox database remained empty and the real database stayed at
  8072 sessions. See `scope-precedence-followup.txt`.
- Lexical-ancestry review failed first at 12 pass and 1 fail because the
  scanner switched to physical parents at a cwd symlink. The corrected
  focused suites passed 36 tests with 0 failures and 79 assertions. Traversal
  now retains lexical parents while canonical paths are limited to boundary
  comparison and duplicate reconciliation.
- Root, adapter, and testing initialization maps now document the production
  misplaced-category diagnostic stage at its actual point after config load.
- Adapter typecheck, full build, QA helper checks, and a final real OpenCode
  project-scope run passed with an empty sandbox database and the real
  database unchanged at 8072. See `lexical-ancestry-followup.txt`.
- A final loader-parity audit reproduced profile precedence and harness-key
  errors, incomplete OpenCode source enumeration, missing home `.opencode`,
  worktree/disable mismatches, unbounded ancestor depth, and inherited test
  discovery state. The combined failing-first run reported 11 pass and 8
  fail.
- The scanner now uses the unified profile resolver, the literal
  `"[opencode]"` harness key, both OpenCode file formats plus legacy
  `config.json`, independent home `.opencode` discovery, worktree and disable
  boundaries, the shared 256-directory limit, and fully isolated discovery
  environment variables. Startup forwards OpenCode's worktree boundary.
- Final focused suites passed 43 tests with 0 failures and 94 assertions.
  Adapter typecheck, full build, and QA helper checks passed. Real OpenCode
  proved `OMO_PROFILE` precedence and the literal harness key, then proved
  project diagnostics remain absent when project config discovery is
  disabled. Both sandboxes stayed empty and the real database remained 8072
  before and after. See `complete-loader-parity-followup.txt`.
- Post-audit source enumeration distinguished the default legacy
  `config.json` from a custom directory's ignored file. A failing-first run
  reported 18 pass and 1 fail; the definitive suite remained 43 pass with 94
  assertions. Real OpenCode emitted exactly two warnings for loaded
  `opencode.json` and default legacy `config.json`, with no custom legacy
  warning.
- The production scanner was split into 58-line diagnostic and 200-line path
  modules so both remain under the repository's 200-line soft limit.
- Global/profile scope review failed first at 19 pass and 1 fail because every
  user source inherited the active profile target. The corrected focused
  suites passed 44 tests with 0 failures and 97 assertions.
- All non-profile OpenCode sources now target the base
  `"[opencode]".categories` layer. Only a recognized profile config directory
  and inline content use the active profile; project targets remain
  OpenCode-harness-scoped in their project file.
- Real OpenCode loaded simultaneous profile and global sources and emitted two
  distinct warnings: the profile source targeted
  `profiles.other."[opencode]".categories`, while the global source targeted
  base `"[opencode]".categories`. The isolated database stayed empty and the
  real database remained 8072 before and after. See
  `profile-global-scope-followup.txt`.
- Dotted profile names failed first at 20 pass and 1 fail because the emitted
  path parsed one record key as two nested keys. The corrected focused suites
  passed 45 tests with 0 failures and 98 assertions. Real OpenCode then
  emitted `profiles."client.prod"."[opencode]".categories` while the
  simultaneous global source stayed at base `"[opencode]".categories`. See
  `dotted-profile-key-followup.txt`.
- Active Desktop edition and unified-home regressions failed first together at
  21 pass and 2 fail. The corrected focused suites passed 47 tests with 0
  failures and 103 assertions.
- Real OpenCode scanned the stable Desktop source and unified `HOME/.opencode`
  source while excluding a simultaneous inactive Desktop-dev source. The
  sandbox database stayed empty and the real database remained 8072 before
  and after. See `active-desktop-home-followup.txt`.
- The disputed related-suite file count was re-run with the exact committed
  command. Bun 1.4.0 reported 23 files again, so the evidence now records that
  direct revalidation instead of replacing it with a manual filename count.
- Ubuntu shard 1 then exposed one stale legacy assertion that still expected
  both Desktop editions. The corrected shared-helper suite passed 31 tests
  with 0 failures and 36 assertions, and the 47 diagnostic/factory tests
  remained green. See `ci-regression-followup.txt`.
- An independent final audit found that the OpenCode binary version probe did
  not identify the running host and that three unrelated factories still ran
  the production scanner. The final implementation now derives host identity
  from OpenCode's official `OPENCODE_CLIENT`, `OPENCODE_CHANNEL`, and Desktop
  `XDG_STATE_HOME` signals, excludes Desktop roots from CLI sessions, and
  stubs the scanner in all direct factories.
- The six affected suites passed 91 tests with 0 failures and 171 assertions.
  Real OpenCode then proved three isolated lanes: CLI scanned no Desktop root,
  stable Desktop scanned only stable, and dev Desktop scanned only dev. Every
  sandbox database stayed empty and the host database remained 8072 before
  and after. See `runtime-host-scope-followup.txt`.

## Why this is enough

The focused tests pin the cross-platform candidate list and both diagnostic
branches. The real OpenCode runs load the locally built plugin through
OpenCode's actual config/plugin startup path and observe each warning on
stderr. Canonical HOME and database paths were asserted to be descendants of
the sandbox; the unchanged real database count is a separate host-state check,
not the basis of the isolation claim.

## What was omitted

Resolved configuration JSON, credentials, auth headers, private user config,
and unrelated OpenCode logs are omitted. The exact relevant warning lines,
exit statuses, portable config fixtures, and database counts are retained.
