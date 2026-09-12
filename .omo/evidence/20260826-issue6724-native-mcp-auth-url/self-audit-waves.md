# Self-Audit Wave Ledger - issue #6724 lane

State machine: wave_number / clean_streak. Any edit to code, tests, comments, or evidence
resets clean_streak=0 and starts a new full wave. Finding waves never count as clean.
Stop condition: TWO consecutive post-final-edit waves with an empty actionable ledger.

## WAVE 1 (clean_streak: 0 -> 1)

Scope (fresh from disk, not from memory):
- Full git diff re-read: packages/mcp-client-core (294 diff lines: index.ts,
  oauth-authorization-flow.ts, provider.ts) + new test file (153 lines).
- Adjacent callers/owners: provider.login()/refresh(), redirectToAuthorization consumers
  (login() destructuring), cli/mcp-oauth/login.ts, skill-mcp-manager/oauth-handler.ts
  (login/refresh/step-up paths), omo-opencode features/mcp-oauth shim re-exports,
  mcp-oauth/index.ts barrel consumers.
- Teardown/error/platform paths: opener-failure close-before-throw, 5-min timeout path,
  handler error/missing-param/success paths, double-close idempotence, darwin/win32/linux
  command selection, detached+windowsHide+unref semantics (c6b178dc7 preserved).

Bug-specific adversarial checks:
- Byte-for-byte guarantee: single authorizationUrl string variable flows to BOTH the
  opener invocation and the return value; no re-serialization. QA proved wire equality.
- Ordering guarantee: startCallbackServer resolves only on the `listening` event; kernel
  backlog then queues the browser redirect until accepted. Test 2 asserts readiness at
  opener-invocation time plus a false-pass guard (port must be closed BEFORE the flow).
- RED reason validity: red-log.txt shows all 3 tests failing because the opener seam was
  ignored, no authorizationUrl was returned, and open failures were swallowed - exactly
  the original-code defect trio (swallowed spawn errors + pre-listen open + no exposure).
- False-pass races: watchdog timers cleared via finally; per-test fresh port allocation;
  pre-flow closed-port assertion in test 2; bounded server-closed poll in test 3.
- Assertion-failure cleanup: flow finally closes the server on all completion paths;
  watchdog-fire leak bounded by the 5-minute server timer and bun process exit.

Ledger:
- P0: none. P1: none. P2: none. P3: none actionable.
- Noise (adjudicated, documented, NO action):
  N1. Exported startCallbackServer shape changed (result-promise -> readiness handle).
      Adjudication: repo-wide GIT_MASTER git grep shows zero remaining external consumers
      (provider import removed); the old shape resolved only at callback time and was the
      vehicle of the ordering bug. Intended API change, recorded here and in README.
  N2. oauth-authorization-flow.ts is 244 LOC vs the 200 soft limit.
      Adjudication: cohesive OAuth redirect primitives (PKCE + callback server + browser
      open + flow); splitting out ~50 lines would add barrel indirection without a
      boundary win. Accepted under the soft limit with rationale.

Wave commands: GIT_MASTER=1 git diff -- packages/mcp-client-core (full read);
GIT_MASTER=1 git grep startCallbackServer; hygiene greps (as any/@ts-ignore/
@ts-expect-error/non-null/filler/emoji: 0 hits); bun test focused suites (107 pass /
0 fail); bunx tsgo --noEmit -p packages/mcp-client-core/tsconfig.json (exit 0).

## WAVE 2 (clean_streak: 1 -> 2)

Scope (fresh from disk): full diff re-read confirmed byte-identical to wave 1 snapshot
(diff of diffs: empty => DIFF-STABLE-SINCE-WAVE1); second orthogonal pass over
openInPlatformBrowser/runAuthorizationCodeRedirect lines 160-244 hunting what wave 1
could have missed:

- Sync-throwing injected openers: propagate through await into the catch (covered).
- void-returning openers: `await undefined` (type allows, covered).
- Handler-close racing finally-close: second close is a no-op via listening check;
  worst case flow resolves before socket drain - identical to original code which never
  awaited close. Not a regression.
- Widened redirectToAuthorization return type: structural superset; sole consumer
  login() destructures { code }; no assignment-site breakage (tsgo exit 0 both pkgs).
- Barrel/shim drift: `export *` shims pick up new exports automatically; type-only barrel
  addition has no runtime effect.
- Security: error message exposes only the authorization URL (client_id, challenge,
  state); PKCE verifier never enters any URL or message. Displaying the URL is the fix.
- Leak audit: every rejection/return path closes the server and clears the timeout;
  listen-failure path clears its own timer before rejecting.
- Repo meta-audits unaffected: no mock.module usage, no raw session.prompt routes.

Ledger: P0/P1/P2/P3 actionable: none. New noise: none (N1/N2 carry over unchanged).

Wave commands: diff-of-diffs stability check; targeted re-read of changed file tail;
bun test focused suites (107 pass / 0 fail); tsgo x2 (exit 0); git diff --check clean;
hygiene greps 0 hits. Gates pass 2 output: gates-pass2.txt.

## POST-LEDGER DRIFT CHECK

Evidence files live under the gitignored .omo/evidence/ path; after writing this ledger,
GIT_MASTER=1 git status --short and the mcp-client-core diff hash are re-verified
unchanged (see final message). Code/test tree frozen since before WAVE 1.

STOP: two consecutive post-final-edit waves (1, 2) with empty actionable ledgers.
