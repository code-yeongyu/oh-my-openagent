# F2 Code Quality Rerun

Result: **F2: PASS**

Branch: `feat/memory-v2-active-learning`

Settled audited commit: `af2f66c1b73c7b6b09141d69dc0de43b74456a69`

Comparison: `origin/dev..HEAD`, matching the original F2 audit. Branch-added-line checks use `git merge-base origin/dev HEAD...HEAD` so lines already present on dev are not misclassified as feature additions.

## Scope and method

- Re-read the prior F2 evidence and its four failing categories.
- Re-read `.omo/rules/test-discipline.md` and applied the task-specified binding 250 pure-LOC ceiling. `.omo/rules/file-size-architectural-smell.md` is not present in the settled worktree, the main checkout, or the tracked `HEAD`/`origin/dev` trees; the explicit task rule and the split evidence's comment-aware measurement definition were therefore authoritative.
- Audited 226 touched `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, and `.mjs` source files after excluding `.omo/`, docs, generated `plugin/extensions/*`, and `install-dist` from ordinary source checks. Generated `plugin/scripts/install.mjs` remained in the size inventory because it is an explicit accepted carry.
- Pure LOC counts non-blank lines containing non-comment source tokens. Comment-only `//`, `#`, and block-comment lines are excluded; string and multiline template-literal content is retained and counted.
- The worktree had an unrelated pre-existing modification to generated `packages/omo-senpi/plugin/extensions/omo.js`. It was not modified or staged by this audit; committed blobs were used for all findings.

## 1. Prior empty-catch finding: closed

The old `worker/spawn.ts` implementation was split. The chmod preparation now lives in `packages/omo-senpi/src/components/memory/worker/spawn-payload.ts`.

- Reflection payload chmod: `catch (error)` ignores only `errorCode(error) === "ENOENT"`; all other errors are rethrown.
- Facts payload chmod: same ENOENT-only behavior.
- `worker/spawn.ts` is now a 3-pure-LOC export-only compatibility barrel.
- A current-tree scan of every touched source file found zero empty or comment-only catch bodies.
- `spawn.test.ts` proves ENOENT continues and EPERM/EACCES propagate.

Focused result: 3 spawn tests passed.

**Category result: PASS**

## 2. Pure-LOC ceiling: closed

Every touched source file was measured. Only the four task-approved exceptions exceed 250 pure LOC:

| Pure LOC | File | Disposition |
|---:|---|---|
| 436 | `packages/omo-senpi/plugin/scripts/install.mjs` | Accepted generated, build-authoritative carry. |
| 411 | `script/sync-lazycodex-marketplace.test.ts` | Accepted pre-existing dev file; untouched by feature commits. |
| 277 | `script/package-registration-audit.test.ts` | Accepted pre-existing dev file; untouched by feature commits. |
| 275 | `packages/omo-native/test/launcher.test.ts` | Accepted pre-existing dev file; untouched by feature commits. |

No other touched source file exceeds 250 pure LOC. The largest non-exempt files are `palace/styles.ts` at 249, `skills-usage.ts` and `journal/store.ts` at 245, and `facts-runner.ts` at 244.

### All 21 prior hard-ceiling findings

| Current pure LOC | Prior file |
|---:|---|
| 149 | `packages/memory-core/src/facts/extraction.test.ts` |
| 136 | `packages/memory-core/src/facts/queue.test.ts` |
| 213 | `packages/memory-core/src/git/repo.ts` |
| 170 | `packages/memory-core/src/people/format.test.ts` |
| 73 | `packages/memory-core/src/tools/memory-apply-patch.test.ts` |
| 151 | `packages/memory-core/src/tools/memory.test.ts` |
| 113 | `packages/omo-config-core/src/schema/memory.test.ts` |
| 436 | `packages/omo-senpi/plugin/scripts/install.mjs` - accepted generated carry |
| 208 | `packages/omo-senpi/src/components/memory/dream-selector.ts` |
| 75 | `packages/omo-senpi/src/components/memory/dream-trigger.test.ts` |
| 154 | `packages/omo-senpi/src/components/memory/dream-trigger.ts` |
| 95 | `packages/omo-senpi/src/components/memory/facts-runner.test.ts` |
| 244 | `packages/omo-senpi/src/components/memory/facts-runner.ts` |
| 47 | `packages/omo-senpi/src/components/memory/palace/template.ts` |
| 70 | `packages/omo-senpi/src/components/memory/skills-usage.test.ts` |
| 60 | `packages/omo-senpi/src/components/memory/tools.test.ts` |
| 213 | `packages/omo-senpi/src/components/memory/trigger-wiring.test.ts` |
| 174 | `packages/omo-senpi/src/components/memory/wiring.ts` |
| 235 | `packages/omo-senpi/src/components/memory/worker/runner.ts` |
| 3 | `packages/omo-senpi/src/components/memory/worker/spawn.ts` |
| 134 | `packages/omo-senpi/src/install/install-senpi.ts` |

The new split units were included in the complete measurement; none exceeds 250.

**Category result: PASS**

## 3. Unicode dash finding: closed

- A zero-context scan of every branch-added line in scoped source found no literal em dash (`U+2014`) or en dash (`U+2013`).
- `packages/omo-config-core/src/schema/memory.ts` now uses an ASCII hyphen.
- `doctor.test.ts` stores the three historical em dashes as source escapes (`\u2014`), leaving zero literal dash bytes in source.
- Rendering those escapes produces exactly three em dashes.
- The rendered fixture is byte-identical to `DEFAULT_PERSONA_BODY` from historical commit `02a7d562e`: 937 bytes and SHA-256 `2e96a09c348bf172428001f4bec8b42fcf493d820bab0dd28b02d267bd3b5bab` on both sides.

**Category result: PASS**

## 4. Test discipline finding: closed

The previously failing suites now use behavioral seams:

- Compile tests parse section boundaries/order, projection paths/tags, and metadata fields. Test-owned body sentinels check inclusion/exclusion; golden prompt files and prose regex pins are gone.
- Apply-patch tests removed the broad output-length ceiling. Truncation behavior is checked through typed errors, runtime truncation markers, and omission of oversized input content.
- Sleeptime tests assert resolved values and per-field override flags, then only notification identity/level at the command surface.
- Doctor retains the stable `abandoned-runs` diagnostic key and path but no longer pins `manual disposal` prose.
- Dream asserts `TypeError`, no submitted request, and identity between the structured error and emitted error notification.
- People tests assert graph nodes/edges, query resolution, parsed card data, selected dates, evidence passed to the child, abstention, and notification state rather than rendered wording.
- MCP tests assert JSON-RPC error state, committed file values, git subjects/trailers, receipts, and receipt absence rather than success prose.

Whole-diff checks found:

- no prose snapshots;
- no compile golden-file comparisons;
- no newly introduced phrase-occurrence tests;
- no broad prose/output length ceiling in the reworked suites;
- no prior banned phrase pins remaining among the cited findings.

The remediation evidence records successful mutation checks for compile structure, apply-patch truncation, sleeptime values, doctor diagnostic key, dream error type, people edge/card/abstention behavior, and MCP commit/receipt state. The focused final run below confirms the restored settled tree is green.

**Category result: PASS**

## 5. General source and test style sweep

- `as any`: none in branch-owned scoped source.
- `@ts-ignore` / `@ts-expect-error`: none in branch-owned scoped source.
- Empty or comment-only catches: none in touched current source.
- Barrel discipline: touched barrel `index.ts` files are export-only. `packages/omo-senpi/src/components/memory/index.ts` remains the pre-existing logic-bearing component entrypoint, not a barrel; no new catch-all barrel violation was introduced.
- Filenames: every touched code filename is lowercase kebab-case, with conventional dot qualifiers such as `.integration.test.ts`, `.ic8.test.ts`, and `.test-support.ts`.
- Given/when/then: touched tests retain nested or inline given/when/then structure; no Arrange/Act/Assert wording was added. Split evidence confirms the final three oversized test splits preserved all 37 test bodies byte-for-byte.

**Category result: PASS**

## 6. Determinism sweep

No fixed sleep, polling delay, or wait-long-enough synchronization was found in branch-added tests.

The remaining timers in new memory tests are bounded rejection circuit breakers around exact signals:

- facts launch promise is subscribed before triggering;
- dream shutdown reservation promise is subscribed before triggering;
- bind-time reconcile warning callback is installed before dispatch;
- supervisor integration helpers subscribe to filesystem, child identity, launch receipt, or process exit before triggering and use timers only to fail with a diagnostic.

No test uses `await sleep(...)`, `setTimeout(resolve, N)`, or an equivalent fixed delay as the synchronization mechanism.

**Category result: PASS**

## Verification

One focused Bun invocation covered the catch remediation and every formerly noncompliant test suite, including split successors:

```text
69 pass
0 fail
177 expect() calls
Ran 69 tests across 15 files. [27.01s]
```

No source file was modified during this rerun.

## Final verdict

All prior F2 findings are closed, and the complete settled-tree diff sweep found no new blocking code-quality violation.

**F2: PASS**
