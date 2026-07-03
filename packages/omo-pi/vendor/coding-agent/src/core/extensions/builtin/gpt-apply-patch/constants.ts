import { Type } from "typebox";

export const APPLY_PATCH_PARAMS = Type.Object({
	input: Type.String({
		description: "The entire contents of the apply_patch command",
	}),
});

export const APPLY_PATCH_FREEFORM_DESCRIPTION =
	"Use the `apply_patch` tool to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON.";
export const APPLY_PATCH_LARK_GRAMMAR = `start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF
`;
export const CODEX_APPLY_PATCH_DESCRIPTION =
	'Use the `apply_patch` tool to edit files.\nYour patch language is a stripped‑down, file‑oriented diff format designed to be easy to parse and safe to apply. You can think of it as a high‑level envelope:\n\n*** Begin Patch\n[ one or more file sections ]\n*** End Patch\n\nWithin that envelope, you get a sequence of file operations.\nYou MUST include a header to specify the action you are taking.\nEach operation starts with one of three headers:\n\n*** Add File: <path> - create a new file. Every following line is a + line (the initial contents).\n*** Delete File: <path> - remove an existing file. Nothing follows.\n*** Update File: <path> - patch an existing file in place (optionally with a rename).\n\nMay be immediately followed by *** Move to: <new path> if you want to rename the file.\nThen one or more “hunks”, each introduced by @@ (optionally followed by a hunk header).\nWithin a hunk each line starts with:\n\nFor instructions on [context_before] and [context_after]:\n- By default, show 3 lines of code immediately above and 3 lines immediately below each change. If a change is within 3 lines of a previous change, do NOT duplicate the first change’s [context_after] lines in the second change’s [context_before] lines.\n- If 3 lines of context is insufficient to uniquely identify the snippet of code within the file, use the @@ operator to indicate the class or function to which the snippet belongs. For instance, we might have:\n@@ class BaseClass\n[3 lines of pre-context]\n- [old_code]\n+ [new_code]\n[3 lines of post-context]\n\n- If a code block is repeated so many times in a class or function such that even a single `@@` statement and 3 lines of context cannot uniquely identify the snippet of code, you can use multiple `@@` statements to jump to the right context. For instance:\n\n@@ class BaseClass\n@@ \t def method():\n[3 lines of pre-context]\n- [old_code]\n+ [new_code]\n[3 lines of post-context]\n\nThe full grammar definition is below:\nPatch := Begin { FileOp } End\nBegin := "*** Begin Patch" NEWLINE\nEnd := "*** End Patch" NEWLINE\nFileOp := AddFile | DeleteFile | UpdateFile\nAddFile := "*** Add File: " path NEWLINE { "+" line NEWLINE }\nDeleteFile := "*** Delete File: " path NEWLINE\nUpdateFile := "*** Update File: " path NEWLINE [ MoveTo ] { Hunk }\nMoveTo := "*** Move to: " newPath NEWLINE\nHunk := "@@" [ header ] NEWLINE { HunkLine } [ "*** End of File" NEWLINE ]\nHunkLine := (" " | "-" | "+") text NEWLINE\n\nA full patch can combine several operations:\n\n*** Begin Patch\n*** Add File: hello.txt\n+Hello world\n*** Update File: src/app.py\n*** Move to: src/main.py\n@@ def greet():\n-print("Hi")\n+print("Hello, world!")\n*** Delete File: obsolete.txt\n*** End Patch\n\nIt is important to remember:\n\n- You must include a header with your intended action (Add/Delete/Update)\n- You must prefix new lines with `+` even when creating a new file\n- File references can only be relative, NEVER ABSOLUTE.\n';
