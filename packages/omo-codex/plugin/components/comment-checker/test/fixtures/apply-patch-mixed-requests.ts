import type { CommentCheckRequest } from "../../src/core.js";

export const mixedApplyPatch = [
	"*** Begin Patch",
	"*** Add File: src/added.ts",
	"+// explains add",
	"+const added = true;",
	"*** Update File: src/original.ts",
	"*** Move to: src/renamed.ts",
	"@@",
	"-const original = true;",
	"+// explains rename",
	"+const renamed = true;",
	"*** Delete File: src/deleted.ts",
	"*** End Patch",
].join("\n");

export const mixedApplyPatchRequests = [
	{
		sourceToolName: "apply_patch",
		toolName: "Write",
		filePath: "src/added.ts",
		toolInput: {
			file_path: "src/added.ts",
			content: "// explains add\nconst added = true;\n",
		},
	},
	{
		sourceToolName: "apply_patch",
		toolName: "Edit",
		filePath: "src/renamed.ts",
		toolInput: {
			file_path: "src/renamed.ts",
			old_string: "const original = true;\n",
			new_string: "// explains rename\nconst renamed = true;\n",
		},
	},
] satisfies CommentCheckRequest[];

export const metadataApplyPatchRequests = [
	{
		sourceToolName: "apply_patch",
		toolName: "Write",
		filePath: "src/direct-added.ts",
		toolInput: {
			file_path: "src/direct-added.ts",
			content: "// explains direct add\nconst directAdd = true;\n",
		},
	},
	{
		sourceToolName: "apply_patch",
		toolName: "Edit",
		filePath: "src/direct-renamed.ts",
		toolInput: {
			file_path: "src/direct-renamed.ts",
			old_string: "const direct = false;\n",
			new_string: "// explains direct edit\nconst direct = true;\n",
		},
	},
] satisfies CommentCheckRequest[];
