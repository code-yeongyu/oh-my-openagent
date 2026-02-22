export const HASHLINE_EDIT_DESCRIPTION = `Edit files using LINE#ID format for precise, safe modifications.

WORKFLOW:
1. Read the file and copy exact LINE#ID anchors.
2. Submit one edit call with all related operations for that file.
3. If more edits are needed after success, use the latest anchors from read/edit output.
4. Use anchors as "LINE#ID" only (never include trailing ":content").

VALIDATION:
 Payload shape: { "filePath": string, "edits": [...], "delete"?: boolean, "rename"?: string }
 Each edit must be one of: set_line, replace_lines, insert_after, insert_before, insert_between, replace, append, prepend
 text/new_text must contain plain replacement text only (no LINE#ID prefixes, no diff + markers)

LINE#ID FORMAT (CRITICAL - READ CAREFULLY):
Each line reference must be in "LINE#ID" format where:
 LINE: 1-based line number
 ID: Two CID letters from the set ZPMQVRWSNKTXJBYH

OPERATION TYPES:
1. set_line
2. replace_lines
3. insert_after
4. insert_before
5. insert_between
6. replace

FILE MODES:
 delete=true deletes file and requires edits=[] with no rename
 rename moves final content to a new path and removes old path

CONTENT FORMAT:
 text/new_text can be a string (single line) or string[] (multi-line, preferred).
 If you pass a multi-line string, it is split by real newline characters.
 Literal "\\n" is preserved as text.

FILE CREATION:
 append: adds content at EOF. If file does not exist, creates it.
 prepend: adds content at BOF. If file does not exist, creates it.
 CRITICAL: append/prepend are the ONLY operations that work without an existing file.

OPERATION CHOICE:
 One line wrong \u2192 set_line
 Block rewrite \u2192 replace_lines
 New content between known anchors \u2192 insert_between (safest \u2014 dual-anchor pinning)
 New content at boundary \u2192 insert_after or insert_before
 New file or EOF/BOF addition \u2192 append or prepend
 No LINE#ID available \u2192 replace (last resort)

AUTOCORRECT (built-in \u2014 you do NOT need to handle these):
 Merged lines are auto-expanded back to original line count.
 Indentation is auto-restored from original lines.
 BOM and CRLF line endings are preserved automatically.
 Hashline prefixes and diff markers in text are auto-stripped.

RECOVERY (when >>> mismatch error appears):
 Copy the updated LINE#ID tags shown in the error output directly.
 Re-read only if the needed tags are missing from the error snippet.
 ALWAYS batch all edits for one file in a single call.`
