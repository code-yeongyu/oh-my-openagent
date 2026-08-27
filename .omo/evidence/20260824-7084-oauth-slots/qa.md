# QA Evidence — Issue #7084: claude-sdk-oauth login appends slots; auth_error never expires

Date: 2026-08-24 · Worktree: `/home/viprix/projects/oom-wt-7084` · Branch: `issue/7084-claude-sdk-oauth-slots`

Final re-verification (same day, after evidence consolidation): regression suite 10 pass / 0 fail
(`after-fix-green.txt`), scoped typecheck exit 0 (`typecheck-omo-senpi.txt`), manifest pin tests
15 pass (`pin-tests.txt`), bundle purity + package shape 5 pass (`purity-shape.txt`).

## WHAT WAS TESTED

The two defect surfaces named in the issue, at module level, against the exact-pinned engine
dependency `@code-yeongyu/senpi@2026.8.23` (the claude-sdk-oauth slot/failover/affinity plumbing
ships inside that dependency; repo-wide greps prove none of it exists in workspace sources):

1. **Bug 1 — login appends slots** (`dist/core/extensions/builtin/claude-sdk-oauth/oauth-login.js`
   L24-33/L113 + `accounts.js` L29-35): `promptAccountName()` defaulted every re-login to a fresh
   `account-${n+1}` and `login()` always `addAccount`ed (append-only, throws on duplicate names).
2. **Bug 2 — auth_error never expires** (`failover.js` L48-52 stripped `blockedUntil` for
   `auth_error`; `affinity.js` L28-40 short-circuited `isBlocked` on the reason string and
   `clearExpiredBlocks` deliberately retained auth stamps forever).

Surface driven: co-located Bun regression suite
`packages/omo-senpi/src/engine-claude-sdk-oauth-slot-recovery.test.ts` importing the pinned dist
modules via resolved file URLs (established repo pattern, cf. `senpi-test-runtime.ts`,
`task-rpc-launch-parity.test.ts`). All inputs are dependency-injected (fake login flow, in-memory
credential store, injected clock). **No real user credential store is read or written; no network;
no token material anywhere in this directory.**

Fix vehicle: bun `patchedDependencies` bridge patch `patches/@code-yeongyu%2Fsenpi@2026.8.23.patch`
(151 lines, 6 dist files) wired in root `package.json` + `bun.lock`. Semantics implemented:

- `upsertAccount()`: same-name slot replaced in place (fresh access/refresh/expires/source, block
  stamps stripped); unknown name appends (explicit multi-account preserved).
- Re-login default name = newest existing login/import slot name instead of `account-N+1`;
  a typed brand-new name still adds a second account.
- `AUTH_ERROR_BLOCK_MS = 30 min`: auth_error stamps now carry `blockedUntil`.
- `isBlocked()` purely time-based; `clearExpiredBlocks()` clears any stamp whose `blockedUntil`
  is absent-or-elapsed (also cleans legacy permanent stamps left by older versions).

## WHAT WAS OBSERVED

- **RED before fix**: `before-fix-red.txt` — 9 fail / 1 pass against the unpatched pin
  (`upsertAccount is not a function`; `AllAccountsBlockedError ... until re-login`;
  legacy auth_error stamp retained). The single pass is the rate-limit guard
  (existing behavior preserved).
- **GREEN after fix**: `after-fix-green.txt` — 10 pass / 0 fail.
- **Fresh-install reproducibility**: removed `node_modules/@code-yeongyu/senpi`, re-ran
  `OMO_SKIP_MATERIALIZE=1 bun install` → truncated patch applies cleanly (`upsertAccount`,
  `defaultRecoveryName`, `AUTH_ERROR_BLOCK_MS` present in installed dist); suite re-run green.
- **Scoped typecheck**: `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` → exit 0
  (`typecheck-omo-senpi.txt`).
- **Manifest pins unaffected**: `bun test packages/omo-native/test/senpi-pin.test.ts
  packages/omo-native/test/package-shape.test.ts` → 15 pass (`pin-tests.txt`).
- **Bundle purity + package shape**: 5 pass (`purity-shape.txt`).

## WHY IT IS ENOUGH

The regression suite pins the exact user-visible semantics from the issue's Expected section:
one Claude.com user → one live slot across re-logins; a dead auth_error slot recovers after
re-login; an elapsed auth_error stamp can no longer dead-end pool selection; legacy permanent
stamps are cleaned; rate-limit windows still block. Tests fail on the shipped pin and pass with
the patch, so they lock the invariant for any future pin bump (a bump without the upstream fix
turns this suite red again). The patch self-invalidates on version drift (loud install failure),
forcing conscious re-review or upstream absorption.

Residual risk: npm-installed `omo-ai` end users receive the fix only when upstream senpi absorbs
it and OmO bumps the pin (same absorption path as issue #7169); until then the patch covers every
bun-install consumer of this monorepo. The 30-minute auth_error TTL is a policy choice per the
task directive ("auth_error gets TTL or explicit invalidation"); re-login remains the primary
recovery path and still clears stamps immediately.

## WHAT WAS OMITTED

- Live TUI `/login claude-sdk-oauth` drive: requires a real Claude.com OAuth round trip
  (account credentials + browser deep link); cannot be performed hermetically. The module-level
  suite drives the exact functions the TUI login path invokes (`createOAuthConfig().login` with
  both headless and onPrompt callback shapes).
- `packages/omo-senpi/plugin/scripts/build-extension.test.mjs`: **pre-existing environmental
  failure in this sandbox**, unrelated to the change — it rebuilds extension bundles under a
  30s in-test timeout and spawns a Node minifier child; it times out here even with pristine
  committed plugin artifacts restored (`git checkout -- packages/*/plugin`), i.e. it fails on
  unmodified dev in this environment too. Captured in `senpi-suite.log`.
- Raw command outputs are captured verbatim except that no credential, token, or auth-header
  material appears anywhere in them (tests use synthetic `access-*` / `refresh-*` strings only).
