# Byte-stable prefix stability

Scope: `packages/omo-opencode/src/plugin/` request prefix (tools export,
system prompt, messages-transform chain, tail channel). Goal: repeated
requests with the same session and model produce identical prefix bytes, so
provider prompt caching stays hot.

## Ordered prefix contract

The prefix is stable only when these four layers hold in order. Do not
reorder without updating `messages-transform-chain-order.test.ts` first.

1. Tools frozen and sorted. `createToolRegistry` freezes the export per
   session (`sessionID` plus gate snapshot) and sorts keys alphabetically
   before normalize. Path: `tool-registry.ts` (`sortToolsRecord`,
   `normalizeSortedTools`, `frozenRegistryCache`). Skill tool description is
   frozen at session start and never rewritten on execute
   (`tools/skill/tools.ts`). Todowrite override applies once per session
   (`tool-definition.ts` handler-local memo).
2. System pinned. Model identity and variant pin per session
   (`plugin/model-identity-pin.ts`). Ultrawork body resolves once per
   (session, agent, model) via `pinnedUltraworkMessage` and repeats return
   the cached body (`hooks/keyword-detector/hook.ts`). Reconciler is a noop
   when rebuilt equals baked.
3. Boundary front. BTW boundary is payload index 0 with deterministic id
   `<side>_btw_boundary`, `time.created` 0, tagged synthetic part
   (`features/btw-side/context-injector.ts`: `createPinnedBoundaryMessage`,
   `frontLoadBoundaryMessage`). Parent context stays bounded via
   `boundBtwParentContext` and is cached per side session. Chain order is
   pinned: btwSideContextInjector (fatal), contextInjectorMessagesTransform,
   teamModeStatusInjector, teamMailboxInjector, toolPairValidator,
   monitorStatusInjector, categorySkillReminder
   (`plugin/messages-transform.ts`: `MESSAGES_TRANSFORM_HOOKS`).
4. Volatile tail. Dynamic injectors confine churn to the payload tail and
   replace, never duplicate (`hooks/shared/volatile-tail.ts`:
   `stripVolatileTail`, `tagVolatileTailParts` with tag key
   `omo-volatile-tail`, `appendVolatileTailMessage`). Tail timestamps are
   quantized to 10s buckets (`messages-transform.ts`
   `createAssistantPrefillRecoveryMessage`,
   `hooks/tool-pair-validator/tool-result-repair.ts`).

Diagnostics: `shared/prefix-hash.ts` (`prefixHash`, sha256 truncated to 16
hex) covers canonical bytes for change-reason logging only. Never send to
providers. Algorithm and length are pinned.

## What breaks cache

Each item below was a RED baseline during the port. Keep them fixed.

* Unsorted export. Registry assembled by spread order (core, interactive
  bash, team, monitor, task, hashline) with conditional gates shifting key
  positions. Fix: sort at export, freeze per session.
* Per-execute rewrites. Skill `execute()` rewrote `cachedDescription` with
  unfiltered skills, leaking agent-restricted entries into the next
  definition fetch. Fix: freeze description, delete the execute-time
  rewrite, sort skill and command names before format.
* Prefix-zone volatiles. Parent context growth, model-routed ultrawork
  bodies, pending context prepends, and per-request definition mutations
  all landed in the prefix. Fix: pin model and variant, front-load only
  stable content, move churn to the tagged tail.
* Raw `Date.now`. Recovery and repair timestamps used raw clock values, so
  double runs differed only in `time.created`. Fix: quantize to 10s
  buckets (`Math.floor(Date.now() / 10_000) * 10_000`). Same bucket gives
  identical bytes. Cross-bucket runs still differ by design.

## Scenarios

Tests in `plugin/prefix-stability-golden.test.ts`. Wording here matches the
test ids.

* S1 (retry same session and model). Exporting the registry twice gives
  byte-identical output. Running messages-transform twice gives
  byte-identical output. Resolving the ultrawork message twice gives
  identical bytes and compute runs once. Test ids: `s1-registry-retry`,
  `s1-transform-retry`, `s1-ultrawork-retry`.
* S2 (model switch). Switching models changes bytes deterministically and
  repeats pin: gpt body differs from gemini body, second resolve of each
  equals the first. Test id: `s2-model-switch` with fixture
  `testdata/golden/model_switch.json`.
* S3 (golden gate plus QA evidence). Fixture-comparison tests plus the
  scoped QA run with evidence on disk gate every change. Test ids:
  `registry-export-golden`, `messages-transform-golden`. Fixtures live in
  `plugin/testdata/golden/`: `registry_export.json` (sorted tool names),
  `messages_transform.json` (pass-through bytes), `model_switch.json`
  (pinned gpt plus gemini bodies).

## Regen procedure

Goldens compare bytes and fail on drift. Regen is gated on `UPDATE_GOLDEN=1`
and only then.

1. Run: `UPDATE_GOLDEN=1 bun test
   packages/omo-opencode/src/plugin/prefix-stability-golden.test.ts`
2. Inspect the diff before committing. Accept ordering and normalization
   churn only, never content loss. Check `registry_export.json` keys stay
   sorted, `messages_transform.json` stays a pass-through, and
   `model_switch.json` still holds both model bodies.
3. Run without the flag to confirm green:
   `bun test packages/omo-opencode/src/plugin/prefix-stability-golden.test.ts`
4. Commit fixtures and test together in one atomic commit.

## MERGE NOTE

Worktree lineage is `origin/dev` at T1 base `7918f2449`. That lineage lacks
`hooks/shared/cache-safe-injection.ts`, which exists in the dev-ahead main
checkout. The new `hooks/shared/volatile-tail.ts` (from this branch) mirrors
the tagged-part shape vendored in `features/btw-side/context-injector.ts`
because the helper was absent here. On merge into the main checkout, dedupe
`hooks/shared/volatile-tail.ts` against `hooks/shared/cache-safe-injection.ts`:
keep one tag key, keep strip-before-append replace semantics, keep tail-only
placement, and point callers (team mailbox, monitor status, goal
continuation) at the surviving helper. Do not keep two parallel tail
helpers.
