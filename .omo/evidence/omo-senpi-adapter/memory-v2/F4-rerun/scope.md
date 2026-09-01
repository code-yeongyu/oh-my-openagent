# F4 Rerun - Scope Fidelity on Settled Tree

Result: **FAIL**

Audit branch: `feat/memory-v2-active-learning`
Audited commit: `595005c402724dbceef33475cbd492b8471f7e99`
Freshly fetched base: `origin/dev` at `4cecf37b7294769f7f38fa41f664582fa239a28e`
Audit date: 2026-08-10
Audited worktree: `/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/memory-v2-active-learning`

The audit reads committed `HEAD` content. A pre-existing unstaged modification to
`packages/omo-senpi/plugin/extensions/omo.js` (194 insertions, 194 deletions) was not created,
modified, staged, or included by this audit.

## 1. Branch currency and version metadata - FAIL

Commands:

```text
git fetch origin dev:refs/remotes/origin/dev
git rev-list --left-right --count origin/dev...HEAD
git log --oneline HEAD..origin/dev
git diff --name-status origin/dev..HEAD
git ls-tree / git show JSON comparison for every package.json version field
git rev-parse origin/dev:<lockfile> HEAD:<lockfile>
```

Fresh result:

```text
git rev-list --left-right --count origin/dev...HEAD
29  54
```

The left/behind count is **29**, not the required 0. `origin/dev` is not an ancestor of `HEAD`.
The prior beta.5 release regression was repaired by merge `8a705227e`, but `origin/dev` advanced
again after that merge. The newest missing base commit is `4cecf37b7 Merge pull request #6700 from
code-yeongyu/fix/windows-root-ci-baseline`; the branch lacks 29 base commits from `e638c8de4`
through `4cecf37b7`.

Version-metadata comparison:

- Package manifest `version` fields: **PASS** - all package.json files present in either tree were
  parsed and compared; 0 `version` fields differ.
- `packages/omo-codex/plugin/package-lock.json`: **PASS** - identical blob
  `06e311da9e03bd5f0f46c7ccacf4211dffe72e4a` in both trees.
- Install-dist/stamp paths: **PASS** - no differing path under an `install-dist` path and no
  stamp-named path appears in `git diff origin/dev..HEAD`.
- `bun.lock`: **FAIL** - base blob
  `8e19339cca6b7bb0deee9e5d4723ac888c88e239` differs from branch blob
  `51df350c184b249b30d4d4316054f87a5b8ebc7a`. The representative residual difference is that
  current `origin/dev` contains the root workspace dependency
  `@oh-my-opencode/omo-opencode: workspace:*`, while `HEAD` does not.

Residual regression: the settled branch is stale by 29 commits and would restore an older root
lock/dependency graph relative to current `origin/dev`. This independently fails check 1 even
though all package version numbers remain at the same release value.

## 2. Scope mapping - PASS

Audit range: `origin/dev..HEAD`. Every non-merge, non-docs implementation commit in that range is
mapped below. Docs/plan/evidence-only commits are review records and are excluded by the check's
explicit non-docs qualification.

| Commit | Mapping |
|---|---|
| `5bca65f69` | Todo 2 - always-on memory reminder |
| `3e00693d8` | Todo 1 - schema/default/config wiring |
| `8d0a1a5b1` | Todo 4 - memory-discipline seed |
| `872d1ee2a` | Todo 23 - reflection enabled guard |
| `2f9b0d24f` | Todo 5 - `/sleeptime` display |
| `2bba9d7b4` | Todo 11 - skills-usage ledger |
| `224638c56` | Todo 16 plus the disclosed persona-seed/Todo 6 collision |
| `a4dd860bc` | Todo 15 - dream persona |
| `eb8a46895` | Binding plan correction supporting Todos 13/25 |
| `b9f030925` | Todo 19 - palace people graph |
| `c5cf7ea46` | Todo 8 - durable facts queue |
| `3347fd4cc` | Required Todo 16 frontmatter hook fix plus disclosed Todo 25 supervisor collision |
| `374a6bf31` | Binding plan correction supporting Todos 8/13/25 |
| `e742edfee` | Disclosed empty Todo 25 marker left by the `3347fd4cc` collision |
| `b83b08e10` | Todo 3 - bounded nudge |
| `2392ea85b` | Todo 24 - dream selector |
| `f10944019` | Required Todo 16 test/type correction |
| `6cf4e8589` | Binding non-destructive recovery correction supporting Todos 9/13 |
| `ed06375a4` | Todo 6 - persona v2 and identity projection |
| `015e0e877` | Todo 6 shipped persona correction |
| `b0fb0f0ef` | Todo 9 - quick-pinned facts extractor |
| `f68a5da3d` | Todo 25 - IC-8 containment and self-deadline |
| `aa67348b2` | Todo 13 - dream reservation/reconciliation |
| `730b84aa1` | Todo 7 - soul notices and receipts |
| `755d55dc1` | Todo 22 - dream worker dispatch |
| `b0563df6a` | Todo 17 - person-fact routing |
| `c029016a0` | Todo 18 - `/people` command |
| `9712e827f` | Todo 10 - shutdown drain |
| `c639c261c` | Required Todo 18 command-config wiring |
| `e9bd18c0b` | Todo 12 - dream triggers |
| `d97ed50c8` | Todo 14 - `/dream` command and staging |
| `aa7ef94e4` | F-wave remediation - runtime gating/default resolver/drain signal threading |
| `0baef0c1f` | F-wave remediation - memory-core LOC splits |
| `47f7c863f` | F-wave remediation - prose contract compliance |
| `2e61de173` | F-wave remediation - behavioral test rework |
| `7e4e0c505` | F-wave remediation - omo-senpi LOC splits |
| `feb6faa3a` | F-wave remediation - spawn/wiring/dream-trigger LOC splits |
| `f801a00c5` | F-wave remediation - final memory-v2 bundle shipment and budget |
| `af2f66c1b` | F-wave remediation - remaining test LOC splits |

Todo 20 is carried by docs commits and Todo 21 is explicitly optional/separate-repository work.
No unmapped non-merge, non-docs commit was found.

### Documented exceptions

GitHub PR #6704 was read with `gh pr view 6704 --json body,comments`.

- PR body explicitly discloses both commit-content collisions:
  - supervisor content in `3347fd4cc`, leaving `e742edfee` empty;
  - persona-v2 seed content in `224638c56`.
- The 2026-08-10 status comment explicitly identifies both sync merges:
  - `43e47c610` - beta.4 senpi-pin sync;
  - `8a705227e` - v5.0.0-beta.5 release sync.
- The same comment explicitly identifies `aa7ef94e4`, `47f7c863f`, `2e61de173`, and LOC splits
  `0baef0c1f`, `7e4e0c505`, `feb6faa3a` as F1/F2 remediation.
- `f801a00c5` and `af2f66c1b` are explicitly listed by the rerun task as in-scope F-wave
  remediation. Their diffs are limited to shipped memory bundle/budget changes and behavioral test
  splits respectively.

The two merge commits introduce base synchronization rather than memory-v2 feature surface and are
now truthfully documented. The prior unmapped-merge finding is resolved.

## 3. Pinned constants - PASS

Committed `HEAD` inspection and focused tests confirm:

- Facts category remains pinned quick: `facts-runner.ts:25` defines
  `QUICK_CATEGORY = "quick"`; line 66 resolves exactly that category. The strict facts schemas at
  `memory.ts:47-50` and `:115-118` expose no category knob.
- Shutdown drain budget remains exactly 1500 ms: `shutdown-drain.ts:11` exports
  `SESSION_SHUTDOWN_DRAIN_BUDGET_MS = 1500`; `shutdownDeadlineAt` adds exactly that constant.
- `/people` remains newest 20 per level: `commands/people.ts:41` exports
  `OBSERVATIONS_PER_LEVEL = 20`; lines 68-70 sort each level descending by date and slice to 20
  unless `--all` is present.
- Nudge cache remains bounded to one entry per `(template, identity, session)` key:
  `compile/cache.ts:36-43` keys by template hash, `agentId`, and `conversationId`, while HEAD/nudge/
  soul state is a replaceable variant rather than part of the map key. The focused test changed the
  nudge variant 100 times and confirmed the cache remains one entry.

Focused verification included the shutdown, people-selection, and cache suites; all passed.

## 4. Defaults three-way agreement - PASS

The remediation removed duplicated adapter literals. All three paths now have one authority:

1. Schema: `OmoMemorySettingsSchema.parse({})` in
   `packages/omo-config-core/src/schema/memory.ts`.
2. Adapter fallback: `resolveMemoryConfig()` in memory `index.ts:145-147` calls
   `resolveMemorySettings(loaded.config.memory)`.
3. Identity runtime: `resolveMemorySettings()` in `identity-runtime.ts:27-30` returns existing
   resolved settings or `OmoMemorySettingsSchema.parse({})`; `createIdentityRuntime()` uses it at
   line 63.

The three paths therefore agree with the complete config contract:

```text
enabled=true
agent=auto
tool_exposure=direct
reflection.enabled=true
reflection.trigger.step_count=25
reflection.trigger.on_compaction=true
reflection.merge=auto
reflection.category=quick
reflection.timeout_minutes=15
reflection.sandbox=auto
nudge.enabled=true
nudge.every_user_turns=10
facts.enabled=true
facts.debounce_settles=4
dream.enabled=true
dream.idle_minutes=30
dream.min_hours_between=24
dream.shutdown_launch=true
dream.auto_select_max=5
dream.auto_select_max_chars=150000
people.enabled=true
people.max_entries=40
people.max_entry_chars=200
soul.edit_notice=true
sync.enabled=true
search.enabled=true
compile_warn_tokens=30000
agents={}
```

Focused schema and adapter tests passed, including the direct assertion that an absent adapter
memory key equals `OmoMemorySettingsSchema.parse({})`.

## 5. Configuration documentation - PASS

`docs/reference/configuration.md:602-706` has a complete memory section. Its documented defaults
match the schema:

- root: enabled true, agent `auto`, tool exposure `direct`, compile warning 30000, agents `{}`;
- reflection: enabled true, step count 25, compaction true, merge `auto`, category `quick`, timeout
  15, sandbox `auto`;
- nudge: enabled true, every 10 user turns;
- facts: enabled true, debounce 4 settles;
- dream: enabled true, idle 30 minutes, spacing 24 hours, shutdown launch true, auto-select 5 and
  150000 characters;
- people: enabled true, 40 entries, 200 characters per entry;
- soul: edit notice true;
- sync/search: both enabled true, with sync remote optional and therefore no concrete default.

No schema/documentation default mismatch was found.

## Focused execution

```text
bun test \
  packages/omo-config-core/src/schema/memory.test.ts \
  packages/omo-config-core/src/schema/memory-v2-blocks.test.ts \
  packages/omo-senpi/src/components/memory/index.test.ts \
  packages/omo-senpi/src/components/memory/shutdown-drain.test.ts \
  packages/omo-senpi/src/components/memory/commands/people-selection.test.ts \
  packages/memory-core/src/compile/cache.test.ts
```

Result: **48 pass, 0 fail, 98 assertions**.

## Final verdict

**F4: FAIL**

Failing item: check 1 branch currency/version metadata. After a fresh fetch, the branch is 29 commits
behind current `origin/dev`, and `bun.lock` differs. Checks 2-5 pass; the prior collision/sync-merge
documentation failure and beta.4 package-version regression are resolved, but current-base drift has
reintroduced a scope-fidelity failure.
