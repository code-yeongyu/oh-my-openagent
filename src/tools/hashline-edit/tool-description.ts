export const HASHLINE_EDIT_DESCRIPTION = `Edit files using LINE#ID format for precise, safe modifications.

WORKFLOW:
1. Read target file/range and copy exact LINE#ID tags.
2. Pick the smallest operation per logical mutation site.
3. Submit one edit call per file with all related operations.
4. If same file needs another call, re-read first.
5. Use anchors as "LINE#ID" only (never include trailing "|content").

<must>
- SNAPSHOT: All edits in one call reference the ORIGINAL file state. Do NOT adjust line numbers for prior edits in the same call — the system applies them bottom-up automatically.
- replace removes lines pos..end (inclusive) and inserts lines in their place. Lines BEFORE pos and AFTER end are UNTOUCHED — do NOT include them in lines. If you do, they will appear twice.
- lines must contain ONLY the content that belongs inside the consumed range. Content after end survives unchanged.
- Tags MUST be copied exactly from read output or >>> mismatch output. NEVER guess tags.
- Batch = multiple operations in edits[], NOT one big replace covering everything. Each operation targets the smallest possible change.
- lines must contain plain replacement text only (no LINE#ID prefixes, no diff + markers).
</must>

<operations>
LINE#ID FORMAT:
  Each line reference must be in "{line_number}#{hash_id}" format where:
  {line_number}: 1-based line number
  {hash_id}: Two CID letters from the set ZPMQVRWSNKTXJBYH

OPERATION CHOICE:
  replace with pos only -> replace one line at pos
  replace with pos+end -> replace range pos..end inclusive as a block (ranges MUST NOT overlap across edits)
  append with pos/end anchor -> insert after that anchor
  prepend with pos/end anchor -> insert before that anchor
  append/prepend without anchors -> EOF/BOF insertion (also creates missing files)

CONTENT FORMAT:
  lines can be a string (single line) or string[] (multi-line, preferred).
  If you pass a multi-line string, it is split by real newline characters.
  lines: null or lines: [] with replace -> delete those lines.

FILE MODES:
  delete=true deletes file and requires edits=[] with no rename
  rename moves final content to a new path and removes old path

RULES:
  1. Minimize scope: one logical mutation site per operation.
  2. Preserve formatting: keep indentation, punctuation, line breaks, trailing commas, brace style.
  3. Prefer insertion over neighbor rewrites: anchor to structural boundaries (}, ], },), not interior property lines.
  4. No no-ops: replacement content must differ from current content.
  5. Touch only requested code: avoid incidental edits.
  6. Use exact current tokens: NEVER rewrite approximately.
  7. For swaps/moves: prefer one range operation over multiple single-line operations.
  8. Anchor to structural lines (function/class/brace), NEVER blank lines.
  9. Re-read after each successful edit call before issuing another on the same file.
</operations>

<examples>
Given this file content after read:
  10#VK|function hello() {
  11#XJ|  console.log("hi");
  12#MB|  console.log("bye");
  13#QR|}
  14#TN|
  15#WS|function world() {

Single-line replace (change line 11):
  { op: "replace", pos: "11#XJ", lines: ["  console.log(\\"hello\\");"] }
  Result: line 11 replaced. Lines 10, 12-15 unchanged.

Range replace (rewrite function body, lines 11-12):
  { op: "replace", pos: "11#XJ", end: "12#MB", lines: ["  return \\"hello world\\";"] }
  Result: lines 11-12 removed, replaced by 1 new line. Lines 10, 13-15 unchanged.

Delete a line:
  { op: "replace", pos: "12#MB", lines: null }
  Result: line 12 removed. Lines 10-11, 13-15 unchanged.

Insert after line 13 (between functions):
  { op: "append", pos: "13#QR", lines: ["", "function added() {", "  return true;", "}"] }
  Result: 4 new lines inserted after line 13. All existing lines unchanged.

BAD — lines extend past end (DUPLICATES line 13):
  { op: "replace", pos: "11#XJ", end: "12#MB", lines: ["  return \\"hi\\";", "}"] }
  Line 13 is "}" which already exists after end. Including "}" in lines duplicates it.
  CORRECT: { op: "replace", pos: "11#XJ", end: "12#MB", lines: ["  return \\"hi\\";"] }
</examples>

<auto>
Built-in autocorrect (you do NOT need to handle these):
  Merged lines are auto-expanded back to original line count.
  Indentation is auto-restored from original lines.
  BOM and CRLF line endings are preserved automatically.
  Hashline prefixes and diff markers in text are auto-stripped.
  Boundary echo lines (duplicating adjacent surviving lines) are auto-stripped.
</auto>

RECOVERY (when >>> mismatch error appears):
  Copy the updated LINE#ID tags shown in the error output directly.
  Re-read only if the needed tags are missing from the error snippet.`
