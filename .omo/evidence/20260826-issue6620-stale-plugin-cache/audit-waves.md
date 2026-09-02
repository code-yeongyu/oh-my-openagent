# Self-audit wave ledger — issue 6620 lane

State machine: wave_number / clean_streak / findings ledger (P0-P3 + noise), per lane mandate.
Scope of every wave: ENTIRE vertical = full git diff of all 5 changed files re-read fresh from disk,
plus adjacent callers/owners/teardown/error/platform paths (hook.ts orchestration,
deferred-startup-check, checker/* incl. cached-version/plugin-entry/latest-version/version-channel,
cache.ts consumers, doctor system-loaded-version reader, index barrels, config schema key check,
docs conventions, generated-bundle hygiene).

## Wave 1 (post GREEN + QA)

findings:
- F1 (P3, docs drift): docs/reference/known-issues.md #5367 said OMO "cannot reliably rewrite"
  the sandbox and mandated manual rm -rf; contradicted by the new automatic invalidation. -> FIXED
  (doc updated: automatic-recovery paragraph + status; manual steps kept for older versions).
- noise (documented-no-code): invalidation expands to both accepted package names
  (oh-my-openagent + legacy oh-my-opencode); duplicate-install conflict is already warned at load;
  both tag entries are stale-by-definition.
- noise (documented-no-code): post-invalidation getCachedVersion() returns null for later sessions
  in the same process; invalidation is terminal for the process, restart applies; reads are guarded.
- noise (documented-no-code): spec-prefix purge cannot match e.g. oh-my-openagent-extra@x because
  of the @ delimiter; pinned by unit test asserting unrelated keys survive.

edit made (docs) -> clean_streak reset to 0; focused tests + tsgo re-run green (gates-run3/run4).

## Wave 2 (post F1 fix, over final tree)

findings: ZERO
- verified: auto_update schema key name correct (config/schema/oh-my-opencode-config.ts:71);
  truthiness->!==undefined broadening in lock delete strictly more correct (noise);
  test mock-setup duplication matches existing file style (noise);
  sandbox-branch test proves branch-specific invalidatePackage call (legacy path unreachable:
  runBunInstallWithDetails not called + early return); autoUpdate=false test pins gate ordering.
clean_streak = 1

## Wave 3 (independent-angle pass)

findings: ZERO
- stale-reference sweep for superseded wording across packages/+docs: single hit is the
  pre-existing isOpenCodeManagedSandbox docstring whose claim is scoped to #4318 flat-path
  install rewriting and remains accurate (noise, no edit).
- tree-state confirmation: same 5-file diff before/after; gates-run3 and gates-run4 executed over
  the byte-identical final tree.
clean_streak = 2 -> STOP

## Exact scope and commands

- Vertical: 5 files (see cleanup-receipt.md list + docs/reference/known-issues.md)
- Focused tests: bun test packages/omo-opencode/src/hooks/auto-update-checker/
  packages/omo-opencode/src/hooks/zauc-mocks-{bg,cache,hook,ws}/  (108 pass, 4 consecutive runs)
- Typecheck: bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json (exit 0, 4 runs)
- GIT_MASTER=1 git diff --check (clean, 4 runs)
- Hygiene: GIT_MASTER=1 git grep -n "as any\|@ts-ignore\|console\.log" on changed paths
  (zero hits; baseline pre-existing fixture string lives in plugin-entry.test.ts, untouched)
- Real-surface QA: bash /tmp/opencode/issue-6620/run-qa.sh (QA_EXIT:0, isolation proven)
