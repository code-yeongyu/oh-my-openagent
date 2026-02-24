export const HASHLINE_EDIT_DESCRIPTION = `Edit files using LINE#ID format for precise, safe modifications.

WORKFLOW:
1. Read target file/range and copy exact LINE#ID tags.
2. Pick the smallest operation per logical mutation site.
3. Submit one edit call per file with all related operations.
4. If same file needs another call, re-read first.
5. Use anchors as "LINE#ID" only (never include trailing "|content").

VALIDATION:
  Payload shape: { "filePath": string, "edits": [...], "delete"?: boolean, "rename"?: string }
  Each edit must be one of: replace, append, prepend
  Edit shape: { "op": "replace"|"append"|"prepend", "pos"?: "LINE#ID", "end"?: "LINE#ID", "lines"?: string|string[]|null }
  lines must contain plain replacement text only (no LINE#ID prefixes, no diff + markers)
  CRITICAL: all operations validate against the same pre-edit file snapshot and apply bottom-up. Refs/tags are interpreted against the last-read version of the file.

LINE#ID FORMAT (CRITICAL):
 Each line reference must be in "{line_number}#{hash_id}" format where:
 {line_number}: 1-based line number
 {hash_id}: Two CID letters from the set ZPMQVRWSNKTXJBYH

FILE MODES:
 delete=true deletes file and requires edits=[] with no rename
 rename moves final content to a new path and removes old path

CONTENT FORMAT:
  lines can be a string (single line) or string[] (multi-line, preferred).
  If you pass a multi-line string, it is split by real newline characters.
  Literal "\\n" is preserved as text.

FILE CREATION:
  append without anchors adds content at EOF. If file does not exist, creates it.
  prepend without anchors adds content at BOF. If file does not exist, creates it.
  CRITICAL: only unanchored append/prepend can create a missing file.

OPERATION CHOICE:
  replace with pos only -> replace one line at pos (MOST COMMON for single-line edits)
  replace with pos+end -> replace ENTIRE range pos..end as a block (ranges MUST NOT overlap across edits)
  append with pos/end anchor -> insert after that anchor
  prepend with pos/end anchor -> insert before that anchor
  append/prepend without anchors -> EOF/BOF insertion

RULES (CRITICAL):
 1. Minimize scope: one logical mutation site per operation.
 2. Preserve formatting: keep indentation, punctuation, line breaks, trailing commas, brace style.
 3. Prefer insertion over neighbor rewrites: anchor to structural boundaries (}, ], },), not interior property lines.
 4. No no-ops: replacement content must differ from current content.
 5. Touch only requested code: avoid incidental edits.
 6. Use exact current tokens: NEVER rewrite approximately.
 7. For swaps/moves: prefer one range operation over multiple single-line operations.
 8. Output tool calls only; no prose or commentary between them.

TAG CHOICE (ALWAYS):
 - Copy tags exactly from read output or >>> mismatch output.
 - NEVER guess tags.
  - Anchor to structural lines (function/class/brace), NEVER blank lines.
  - Anti-pattern warning: blank/whitespace anchors are fragile.
  - Re-read after each successful edit call before issuing another on the same file.

AUTOCORRECT (built-in - you do NOT need to handle these):
 Merged lines are auto-expanded back to original line count.
 Indentation is auto-restored from original lines.
 BOM and CRLF line endings are preserved automatically.
 Hashline prefixes and diff markers in text are auto-stripped.

RECOVERY (when >>> mismatch error appears):
 Copy the updated LINE#ID tags shown in the error output directly.
 Re-read only if the needed tags are missing from the error snippet.
 ALWAYS batch all edits for one file in a single call.`
