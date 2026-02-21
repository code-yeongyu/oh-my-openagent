export const HASHLINE_EDIT_DESCRIPTION = `Edit files using LINE#ID format for precise, safe modifications.

WORKFLOW:
1. Read the file and copy exact LINE#ID anchors.
2. Submit one edit call with all related operations for that file.
3. If more edits are needed after success, use the latest anchors from read/edit output.
4. Use anchors as "LINE#ID" only (never include trailing ":content").

VALIDATION:
- Payload shape: { "filePath": string, "edits": [...], "delete"?: boolean, "rename"?: string }
- Each edit must be one of: set_line, replace_lines, insert_after, insert_before, insert_between, replace
- text/new_text must contain plain replacement text only (no LINE#ID prefixes, no diff + markers)

LINE#ID FORMAT (CRITICAL - READ CAREFULLY):
Each line reference must be in "LINE#ID" format where:
- LINE: 1-based line number
- ID: Two CID letters from the set ZPMQVRWSNKTXJBYH

OPERATION TYPES:
1. set_line
2. replace_lines
3. insert_after
4. insert_before
5. insert_between
6. replace

FILE MODES:
- delete=true deletes file and requires edits=[] with no rename
- rename moves final content to a new path and removes old path

CONTENT FORMAT:
- text/new_text can be a string (single line) or string[] (multi-line, preferred).
- If you pass a multi-line string, it is split by real newline characters.
- Literal "\\n" is preserved as text.`
