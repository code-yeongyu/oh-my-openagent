# hashline-core — Hash-Anchored Edit Primitives (Core)

**Generated:** 2026-06-17

## OVERVIEW

The engine behind the Hashline edit tool (inspired by [oh-my-pi](https://github.com/can1357/oh-my-pi)). Tags every line with a `LINE#HASH|` content hash, validates edit refs against current content (rejecting stale lines), then applies structured `replace`/`append`/`prepend` edits with autocorrection, deduplication, and unified-diff generation. Package: `@oh-my-opencode/hashline-core`.

## PUBLIC API (`src/index.ts`, ~26 fns + 7 types) — by area

| Area | Files | Key exports |
|------|-------|-------------|
| **Hash compute** | `hash-computation.ts`, `xxhash32.ts`, `constants.ts` | `computeLineHash`, `computeLegacyLineHash`, `formatHashLine(s)`, `streamHashLinesFrom{Utf8,Lines}`, `NIBBLE_STR`, `HASHLINE_DICT` |
| **Validation** | `validation.ts` | `parseLineRef`, `validateLineRef(s)`, `normalizeLineRef`, `HashlineMismatchError` |
| **Apply** | `edit-operations.ts`, `edit-operation-primitives.ts` | `applyHashlineEdits`, `applyHashlineEditsWithReport`, `apply{SetLine,ReplaceLines,InsertAfter,InsertBefore,Append,Prepend}` |
| **Normalize/dedup/order** | `normalize-edits.ts`, `edit-deduplication.ts`, `edit-ordering.ts` | `normalizeHashlineEdits`, `dedupeEdits`, `detectOverlappingRanges` |
| **Autocorrect** | `autocorrect-replacement-lines.ts`, `edit-text-normalization.ts` | `autocorrectReplacementLines`, prefix/indent/echo strippers |
| **Diff/display** | `diff-utils.ts`, `hashline-edit-diff.ts` | `toHashlineContent`, `generateUnifiedDiff`, `countLineDiffs`, `generateHashlineDiff` |
| **Canonicalize/chunk** | `file-text-canonicalization.ts`, `hashline-chunk-formatter.ts` | `canonicalizeFileText`/`restoreFileText` (BOM + LF/CRLF), `createHashlineChunkFormatter` (200 lines / 64 KB) |

## DEPENDENCIES & CONSUMERS

- **Depends on:** `diff` (^9) — for `createTwoFilesPatch` in `generateUnifiedDiff` only. Otherwise self-contained.
- **Consumed by:** the ~15 thin re-export shims under `omo-opencode/src/tools/hashline-edit/`. NOT consumed by the Codex edition (Light has no hashline).

## NOTES

- **"Option 2" hashing:** no npm xxhash dependency. `xxhash32.ts` prefers native `Bun.hash.xxHash32()` at call time and falls back to a pure-JS impl, so it runs under Bun and Node.
- **Legacy hash compatibility:** validation accepts both `computeLineHash` (trimEnd + strip `\r`) and `computeLegacyLineHash` (strip ALL whitespace) — old stored hashes still validate.
- **Seed rule:** content lines seed `0`; whitespace-only lines seed `lineNumber` (distinct hash per position).
- **`normalizeHashlineEdits` rejects unknown ops** with `"Legacy format was removed; use op/pos/end/lines."` — the discriminated union is `replace | append | prepend` only.
- Parent: [`packages/AGENTS.md`](../AGENTS.md).
