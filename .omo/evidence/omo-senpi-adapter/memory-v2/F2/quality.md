# F2 Code Quality Review

Result: **F2: FAIL**

Branch reviewed: `feat/memory-v2-active-learning`

Comparison: `origin/dev..HEAD`

## Scope and method

- Reviewed all 223 touched files after excluding `.omo/`, `docs/`, `packages/omo-senpi/plugin/extensions/*.js`, and `install-dist`.
- Deep source review covered all 148 touched `.ts`, `.tsx`, `.mjs`, and non-generated `.js` files, with emphasis on the 145 TypeScript files under `packages/memory-core` and `packages/omo-senpi`.
- Reviewed 53 touched test files for given/when/then structure, banned prose pins, snapshots, length ceilings, and nondeterministic waiting.
- Pure LOC means non-blank, non-comment lines. Comment stripping preserved strings and template literals, so executable multiline template content counts as source.
- Branch-added lines were separately inspected for suppressions, Unicode dashes, emojis, Arrange/Act/Assert wording, and timer calls. Pre-existing Unicode lines on `origin/dev` were exempt as requested.

## 1. Suppressions, catches, and catch-all files

| File | Line | Issue | Severity |
|---|---:|---|---|
| `packages/omo-senpi/src/components/memory/worker/spawn.ts` | 138-140 | Comment-only `catch {}` silently swallows every `chmod` failure, not only the expected missing-file case. This is functionally an empty catch block. | VIOLATION |
| `packages/omo-senpi/src/components/memory/worker/spawn.ts` | 232-234 | Second comment-only `catch {}` silently swallows every `chmod` failure. | VIOLATION |

No `as any`, `@ts-ignore`, or `@ts-expect-error` was found in the scoped changes. No touched file is named `utils.ts`, `helpers.ts`, or `service.ts`.

## 2. File discipline: pure LOC

### Hard ceiling violations: over 250 pure LOC

| File | Line | Issue | Severity |
|---|---:|---|---|
| `packages/memory-core/src/facts/extraction.test.ts` | whole file | 319 pure LOC; new file. | VIOLATION |
| `packages/memory-core/src/facts/queue.test.ts` | whole file | 268 pure LOC; new file. | VIOLATION |
| `packages/memory-core/src/git/repo.ts` | whole file | 288 pure LOC, up from 230 on `origin/dev`. | VIOLATION |
| `packages/memory-core/src/people/format.test.ts` | whole file | 373 pure LOC; new file. | VIOLATION |
| `packages/memory-core/src/tools/memory-apply-patch.test.ts` | whole file | 266 pure LOC, up from 253 on `origin/dev`. | VIOLATION |
| `packages/memory-core/src/tools/memory.test.ts` | whole file | 260 pure LOC, up from 240 on `origin/dev`. | VIOLATION |
| `packages/omo-config-core/src/schema/memory.test.ts` | whole file | 278 pure LOC, up from 102 on `origin/dev`. | VIOLATION |
| `packages/omo-senpi/plugin/scripts/install.mjs` | whole file | 436 pure LOC, up from 435 on `origin/dev`. | VIOLATION |
| `packages/omo-senpi/src/components/memory/dream-selector.ts` | whole file | 277 pure LOC; new file. | VIOLATION |
| `packages/omo-senpi/src/components/memory/dream-trigger.test.ts` | whole file | 491 pure LOC; new file. | VIOLATION |
| `packages/omo-senpi/src/components/memory/dream-trigger.ts` | whole file | 282 pure LOC; new file. | VIOLATION |
| `packages/omo-senpi/src/components/memory/facts-runner.test.ts` | whole file | 262 pure LOC; new file. | VIOLATION |
| `packages/omo-senpi/src/components/memory/facts-runner.ts` | whole file | 402 pure LOC; new file. | VIOLATION |
| `packages/omo-senpi/src/components/memory/palace/template.ts` | whole file | 473 pure LOC, up from 391 on `origin/dev`. | VIOLATION |
| `packages/omo-senpi/src/components/memory/skills-usage.test.ts` | whole file | 265 pure LOC; new file. | VIOLATION |
| `packages/omo-senpi/src/components/memory/tools.test.ts` | whole file | 292 pure LOC, up from 233 on `origin/dev`. | VIOLATION |
| `packages/omo-senpi/src/components/memory/trigger-wiring.test.ts` | whole file | 362 pure LOC, up from 306 on `origin/dev`. | VIOLATION |
| `packages/omo-senpi/src/components/memory/wiring.ts` | whole file | 434 pure LOC, up from 248 on `origin/dev`. | VIOLATION |
| `packages/omo-senpi/src/components/memory/worker/runner.ts` | whole file | 284 pure LOC, up from 243 on `origin/dev`. | VIOLATION |
| `packages/omo-senpi/src/components/memory/worker/spawn.ts` | whole file | 521 pure LOC, up from 219 on `origin/dev`. | VIOLATION |
| `packages/omo-senpi/src/install/install-senpi.ts` | whole file | 262 pure LOC, up from 261 on `origin/dev`. | VIOLATION |

### Soft-limit notes: 201-250 pure LOC

| File | Line | Issue | Severity |
|---|---:|---|---|
| `packages/memory-core/src/facts/extraction.ts` | whole file | 221 pure LOC; over the 200 soft limit. | NOTE |
| `packages/memory-core/src/facts/person-routing.ts` | whole file | 238 pure LOC; over the 200 soft limit. | NOTE |
| `packages/memory-core/src/facts/queue.ts` | whole file | 212 pure LOC; over the 200 soft limit. | NOTE |
| `packages/memory-core/src/journal/store.ts` | whole file | 245 pure LOC; over the 200 soft limit. | NOTE |
| `packages/memory-core/src/memfs/frontmatter-kind-aliases.test.ts` | whole file | 235 pure LOC; over the 200 soft limit. | NOTE |
| `packages/memory-core/src/people/format.ts` | whole file | 241 pure LOC; over the 200 soft limit. | NOTE |
| `packages/memory-core/src/reflection/machine.ts` | whole file | 229 pure LOC; over the 200 soft limit. | NOTE |
| `packages/memory-core/src/reflection/reservation.ts` | whole file | 228 pure LOC; over the 200 soft limit. | NOTE |
| `packages/memory-core/src/tools/memory-apply-patch.ts` | whole file | 226 pure LOC; over the 200 soft limit. | NOTE |
| `packages/memory-core/src/tools/memory.ts` | whole file | 240 pure LOC; over the 200 soft limit. | NOTE |
| `packages/omo-senpi/plugin/scripts/build-extension.mjs` | whole file | 243 pure LOC; over the 200 soft limit. | NOTE |
| `packages/omo-senpi/src/components/memory/commands/people.test.ts` | whole file | 232 pure LOC; over the 200 soft limit. | NOTE |
| `packages/omo-senpi/src/components/memory/nudge-wiring.test.ts` | whole file | 218 pure LOC; over the 200 soft limit. | NOTE |
| `packages/omo-senpi/src/components/memory/prompt.test.ts` | whole file | 216 pure LOC; over the 200 soft limit. | NOTE |
| `packages/omo-senpi/src/components/memory/shutdown-drain.test.ts` | whole file | 201 pure LOC; over the 200 soft limit. | NOTE |
| `packages/omo-senpi/src/components/memory/skills-usage.ts` | whole file | 245 pure LOC; over the 200 soft limit. | NOTE |
| `packages/omo-senpi/src/components/memory/worker/memory-run-supervisor.integration.test.ts` | whole file | 241 pure LOC; over the 200 soft limit. | NOTE |
| `packages/omo-senpi/src/install/install-senpi.test.ts` | whole file | 235 pure LOC; over the 200 soft limit. | NOTE |
| `packages/omo-senpi/src/mcp/memory-server.test.ts` | whole file | 204 pure LOC; over the 200 soft limit. | NOTE |
| `packages/omo-senpi/src/mcp/memory-server.ts` | whole file | 218 pure LOC; over the 200 soft limit. | NOTE |

## 3. Barrel files

| File | Line | Issue | Severity |
|---|---:|---|---|
| `packages/omo-senpi/src/components/memory/index.ts` | 1-224 | This remains a logic-bearing component entrypoint named `index.ts`, and the branch adds more implementation to it. It is not an export-only barrel. The pattern predates this branch, so this is recorded as an architectural note rather than a hard F2 failure. | NOTE |

The other touched `index.ts` files are export-only barrels.

## 4. Test style

No test-style violation was found. Every scoped touched test file uses nested or inline given/when/then markers. No Arrange-Act-Assert wording was introduced.

## 5. Emojis and Unicode dashes in introduced source

| File | Line | Issue | Severity |
|---|---:|---|---|
| `packages/omo-config-core/src/schema/memory.ts` | 44 | Branch-added source comment contains an em dash. | VIOLATION |
| `packages/omo-senpi/src/components/memory/commands/doctor.test.ts` | 63-65 | Branch-added TypeScript fixture contains three em dashes. The bytes may be intentionally historical, but the rule has no source-fixture exception. | VIOLATION |
| `packages/omo-senpi/src/components/memory/dream-selector.test.ts` | 158, 192 | Branch-added test data contains an emoji. It is useful UTF-8 test data, but it conflicts with the literal no-emoji source rule. Emoji is not included in the task's hard-failure list, so this is non-blocking here. | NOTE |

No introduced en dash was found.

## 6. Zod boundaries and filenames

| File | Line | Issue | Severity |
|---|---:|---|---|
| `packages/memory-core/src/facts/schema.ts` | 107-218 | Durable queue, cursor, and consumed JSON boundaries are validated by hand-written record guards rather than Zod schemas. | NOTE |
| `packages/memory-core/src/facts/extraction.ts` | 65-223 | Child-produced JSONL is parsed and validated manually at a process boundary rather than through Zod. | NOTE |
| `packages/omo-senpi/src/components/memory/dream-selector.ts` | 214-232 | Persisted dream state uses `JSON.parse` plus manual narrowing instead of Zod. | NOTE |
| `packages/omo-senpi/src/components/memory/skills-usage.ts` | 124-151 | Persisted skill-usage JSON is manually narrowed instead of using Zod. | NOTE |
| `packages/omo-senpi/src/components/memory/worker/run-artifacts.ts` | 31-33 | `readRunJson<T>` performs an unchecked generic cast directly from `JSON.parse`, so this boundary is not runtime validated. | NOTE |
| `packages/omo-senpi/src/mcp/memory-server.ts` | 130-139 | MCP arguments are asserted to `MemoryToolParams`; the adjacent comment explicitly delegates validation instead of applying a boundary schema. | NOTE |

All touched code filenames are kebab-case. No filename violation was found.

## 7. Test-discipline compliance

| File | Line | Issue | Severity |
|---|---:|---|---|
| `packages/memory-core/src/compile/compile.test.ts` | 66, 89, 127, 145 | Full compiled prompt output is compared to golden text files. Normalizing one reminder line does not stop the tests from pinning the remaining prose and full-text rendering. | VIOLATION |
| `packages/memory-core/src/compile/compile.test.ts` | 170, 196 | Regex assertions pin prose wording even though stable machine tokens are already available and asserted. | VIOLATION |
| `packages/memory-core/src/tools/memory-apply-patch.test.ts` | 302 | A touched test retains an explicit output-length ceiling (`error.message.length < 7000`), which is banned by the requested test-discipline gate. | VIOLATION |
| `packages/omo-senpi/src/components/memory/commands/sleeptime.test.ts` | 27-104 | Added assertions pin many user-facing output phrases such as `Nudge: on`, `Dream: on`, and override wording instead of asserting parsed/machine-consumed values. | VIOLATION |
| `packages/omo-senpi/src/components/memory/commands/doctor.test.ts` | 201 | Added assertion pins the user-facing phrase `manual disposal`. The stable diagnostic key is already asserted separately. | VIOLATION |
| `packages/omo-senpi/src/components/memory/commands/dream.test.ts` | 185 | Added assertion pins the user-facing error prose `only senpi session JSONL`. | VIOLATION |
| `packages/omo-senpi/src/components/memory/commands/people.test.ts` | 194-228, 254, 283, 306 | New command tests pin rendered prose and answer wording rather than a structured command result. | VIOLATION |
| `packages/omo-senpi/src/mcp/memory-server.test.ts` | 129, 192 | Added assertions pin full user-facing success phrases from tool output. Commit state and structured receipts are already available behavioral seams. | VIOLATION |

No Jest/Bun prose snapshots were found. Machine-consumed cardinality checks such as active-plus-pending reservation count and configured `max_entries` were not treated as prose length ceilings.

## 8. Determinism

No timing-luck violation was found in the newly added tests.

- `facts-wiring.test.ts:95` subscribes to the exact launch promise before triggering and uses `setTimeout` only as a bounded failure circuit breaker.
- `shutdown-drain.test.ts:238` installs the warning callback before dispatch and uses a bounded failure circuit breaker.
- Supervisor integration tests subscribe to filesystem, socket, stdout, or child-exit signals before the relevant trigger and use timers only to reject on timeout.
- No fixed sleep, polling delay, or wait-long-enough synchronization mechanic was found in the new tests.

Production timers and retry delays were not classified as test nondeterminism.

## Final failing items

1. Two functionally empty catch blocks in `packages/omo-senpi/src/components/memory/worker/spawn.ts`.
2. Twenty-one files exceed the 250 pure-LOC hard ceiling, as listed in the hard-ceiling table.
3. Introduced em dashes in `packages/omo-config-core/src/schema/memory.ts` and `packages/omo-senpi/src/components/memory/commands/doctor.test.ts`.
4. Banned test shapes in the compile golden tests, prose phrase-pin tests, and the retained output-length ceiling listed above.

**F2: FAIL**
