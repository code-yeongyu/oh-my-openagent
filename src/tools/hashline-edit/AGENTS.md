# src/tools/hashline-edit/ — Hash-Anchored File Edit Tool

**Generated:** 2026-02-24

## OVERVIEW

24 files. Implements the `hashline_edit` tool — hash-anchored file editing where every line reference includes a content hash (`LINE#ID`). Validates hashes before applying edits, rejecting stale references.

## THREE-OP MODEL

All edits use exactly 3 operations:

| Op | pos | end | lines | Effect |
|----|-----|-----|-------|--------|
| `replace` | required | optional | required | Replace single line or range pos..end |
| `append` | optional | optional | required | Insert after anchor (or EOF if no anchor) |
| `prepend` | optional | optional | required | Insert before anchor (or BOF if no anchor) |

`lines: null` or `lines: []` with `replace` = delete. `delete: true` at tool level = delete file.

## EXECUTION PIPELINE

```
hashline-edit-executor.ts
  → normalize-edits.ts       # Parse RawHashlineEdit → HashlineEdit (validate op schema)
  → validation.ts            # Validate LINE#ID references (hash match, line exists)
  → edit-ordering.ts         # Sort bottom-up (by line number, descending)
  → edit-deduplication.ts    # Remove duplicate ops
  → edit-operations.ts       # Apply each op using edit-operation-primitives.ts
  → autocorrect-replacement-lines.ts  # Auto-fix indentation/formatting
  → hashline-edit-diff.ts    # Build diff output using diff-utils.ts
```

## KEY FILES

| File | Purpose |
|------|---------|
| `tools.ts` | `createHashlineEditTool()` factory — tool schema + entry point |
| `hashline-edit-executor.ts` | Main execution: normalize → validate → order → apply → diff |
| `normalize-edits.ts` | Parse `RawHashlineEdit[]` (allows string `op` variants) → typed `HashlineEdit[]` |
| `validation.ts` | Validate LINE#ID: parse hash, verify line content matches stored hash |
| `hash-computation.ts` | `computeLineHash(line)` → 2-char CID from set `ZPMQVRWSNKTXJBYH` |
| `edit-operations.ts` | Apply replace/append/prepend to file lines array |
| `edit-operation-primitives.ts` | Low-level line array mutation primitives |
| `edit-ordering.ts` | Sort edits bottom-up to preserve line numbers during multi-edit |
| `edit-deduplication.ts` | Deduplicate overlapping/identical operations |
| `edit-text-normalization.ts` | Normalize line content (CRLF, BOM, trailing whitespace) |
| `file-text-canonicalization.ts` | Canonicalize full file content before hashing |
| `autocorrect-replacement-lines.ts` | Auto-restore indentation from original lines |
| `hashline-edit-diff.ts` | Generate unified diff for error/success messages |
| `diff-utils.ts` | Thin wrapper around `diff` npm library |
| `hashline-chunk-formatter.ts` | Format line chunks with `LINE#ID` tags |
| `tool-description.ts` | `HASHLINE_EDIT_DESCRIPTION` constant |
| `types.ts` | `HashlineEdit`, `ReplaceEdit`, `AppendEdit`, `PrependEdit` |
| `constants.ts` | Hash alphabet, separator character (`#`), pipe separator (`|`) |

## LINE#ID FORMAT

```
{line_number}#{hash_id}
```

- `hash_id`: two chars from `ZPMQVRWSNKTXJBYH` (CID letters)
- Example: `42#VK` means line 42 with hash `VK`
- Validation: recompute hash of current line content → must match stored hash
- Content separator: `|` (pipe) between hash tag and content in read output

## AUTOCORRECT BEHAVIORS (built-in)

- Merged lines auto-expanded back to original count
- Indentation restored from original lines
- BOM and CRLF line endings preserved
- `>>>` prefix and diff markers in `lines` text auto-stripped

## ERROR CASES

- Hash mismatch → edit rejected, diff shown with current state
- Overlapping ranges → detected and rejected
- Missing `pos` for `replace` → schema error
- `lines: null` with `append`/`prepend` → schema error

## HOW LINE HASHES WORK

```typescript
// Reading: every line gets tagged
"42#VK| function hello() {"

// Editing: reference by tag
{ op: "replace", pos: "42#VK", lines: "function hello(name: string) {" }

// If file changed since read: hash won't match → rejected before corruption
```
