# Evidence: Issue #6784 - Claude SDK OAuth lane diagnosis for session title generation

Date: 2026-08-24
Branch: issue/6784-claude-oauth-title-gen (base dev @8833800ae)

## Root Cause

The reporter's task aborts with `Runtime error (session_title_generation):
Claude Code returned an error result: Failed to authenticate: OAuth session
expired and could not be refreshed` while `omo doctor` reports all-PASS.

Traced against the exact engine builds involved:

- Title generation lives in the pinned engine, not this repo.
  `@code-yeongyu/senpi@2026.8.11-4` (reporter's build,
  `dist/core/agent-session.js:2366`) and the current pin `2026.8.23`
  (`dist/core/agent-session.js:2793`) both wrap `_generateSessionTitle()` in a
  catch that emits a non-fatal `session_title_generation` runtime error event;
  every mode renders it without aborting (interactive headline via
  `dist/modes/interactive/extension-error-format.js:28`, print-mode
  `console.error`, rpc `extension_error` event). Non-fatality already holds at
  both pins; verified by downloading the 2026.8.11-4 tarball and reading the
  installed 2026.8.23 dist.
- The auth failure itself comes from lane resolution:
  `dist/core/extensions/builtin/claude-sdk-oauth/auth-lane.js:36`
  (`settings.tokenInjection ?? (accounts.length > 0 ? "oauth-slots" :
  "ambient")`). When no usable claude-sdk-oauth slots are visible to the
  engine, background calls fall back to the Claude CLI's own login and fail
  when that CLI is logged out - exactly the reported error string.
- This repo's gap: `omo doctor` had zero claude-sdk-oauth visibility. The
  issue's own doctor output shows all-PASS while the lane was broken, so users
  get no diagnosis and no remediation pointer. The legacy flat layout mentioned
  in the issue (`C:\Users\<USER>\.omo\auth.json`) is already carried forward by
  `adoptLegacyFlatState()` (`packages/omo-native/bin/lib/agent-dir.js`,
  `ADOPTED_STATE_FILES` includes `auth.json`).

## Fix

New read-only doctor check `assessClaudeSdkOauthLane()`
(`packages/omo-native/bin/lib/claude-oauth-lane.js`), wired into
`runDoctor()` (`packages/omo-native/bin/lib/doctor.js`). It mirrors the pinned
engine's lane resolution so doctor names the state that produces the reported
failure:

- disabled by configuration (`SENPI_CLAUDE_SDK_OAUTH_ENABLED=0|false` or
  settings `claudeSdkOauthProvider.enabled: false`) -> PASS line, no noise;
- token injection `ambient` pinned in settings/env -> PASS line naming it;
- saved login with zero account slots -> FAIL: background calls fall back to
  the Claude CLI's own login; run omo, then `/login claude-sdk-oauth`;
- all slots blocked (`blockReason === "auth_error"`) or expired
  (`expires <= now`) -> FAIL with slot count and the same remediation;
- mixed slots -> PASS disclosing the unusable count;
- corrupt `auth.json` -> WARN without failing the run;
- provider never used -> check stays silent.

Mirror semantics verified line-by-line against the pinned engine dist:
settings key `claudeSdkOauthProvider` + `parseTokenInjection`/
`parseEnvironmentBoolean` env names (`.../claude-sdk-oauth/settings.js:30,60,78`),
credential/slot shape (`accounts.js:7-10`), blocked-slot rule
(`affinity.js:29`, `account-command.js:11`). Read-only on purpose: doctor never
mutates credential state.

## WHAT WAS TESTED

- Failing first: hid `claude-oauth-lane.js` and ran
  `bun test packages/omo-native/test/claude-oauth-lane.test.ts` ->
  module-not-found failure (`new-tests-red-before-fix.txt`).
- Co-located regression suite `packages/omo-native/test/claude-oauth-lane.test.ts`
  (given/when/then): silent when unused, fresh-slot PASS, all-blocked FAIL,
  all-expired FAIL, mixed disclosure, zero-slot FAIL, env-token counting,
  disabled-by-config, ambient settings, env override beating settings, corrupt
  store WARN, plus two end-to-end tests that copy `bin/` into a fixture
  install, spawn the real launcher (`omo doctor`) and assert exit code 1 with
  the actionable FAIL line, and exit code 0 with no lane noise for unused
  installs.
- Scoped package suite: `bun test packages/omo-native/test`.
- Typecheck: `bunx tsc -p packages/omo-native/tsconfig.json --noEmit`.
- Entry smoke: `node packages/omo-native/bin/omo.js --version`.

## WHAT WAS OBSERVED

- Red before fix: 0 pass / 1 fail / 1 error, `Cannot find module
  '../bin/lib/claude-oauth-lane.js'` (`new-tests-red-before-fix.txt`).
- After fix: full package suite 140 pass / 6 skip / 0 fail, 419 expect() calls
  (`scoped-tests-after.txt`).
- Typecheck exit 0, no output (`typecheck.txt`).
- Entry smoke prints `omo 5.0.0-0.beta.18 (engine: senpi 2026.8.23)`, exit 0
  (`entry-smoke.txt`).

## WHY IT IS ENOUGH

The change is confined to the omo-native launcher surface this repo owns, and
the tests pin every branch of the new assessment plus the real spawned-doctor
wiring and exit codes. The mirror was checked against the actual pinned engine
dist (both the reporter's build and the current pin), so the advice doctor
prints cannot drift from engine behavior for these pins. Users hitting the
reported failure now get a FAIL line that names the broken lane and the exact
remediation instead of an all-PASS wall. Residual risk: a future engine pin
that changes lane semantics would require updating the mirror; the unit tests
document the mirrored rules explicitly to make that diff reviewable.

## WHAT WAS OMITTED

- Live Windows reproduction: the issue reproduces on Windows 11, but the lane
  assessment is platform-neutral file/env reading covered by unit + spawned
  e2e tests on Linux; no Windows-specific code path exists in the diff.
- Engine behavior changes: non-fatality already holds at both pins (verified
  in both dists); patching the external engine is out of scope for this repo.
- No secrets: fixtures use throwaway temp agent dirs and fake token strings;
  the real `~/.omo` state is never read by tests.
