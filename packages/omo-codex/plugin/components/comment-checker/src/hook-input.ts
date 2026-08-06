import type { CommentCheckerHookInput, CommentCheckRequest } from "./types.js";

export function toHookInput(
	request: CommentCheckRequest,
	context: {
		readonly sessionId: string;
		readonly cwd: string;
		readonly transcriptPath?: string;
	},
): CommentCheckerHookInput {
	return {
		session_id: context.sessionId,
		tool_name: request.toolName,
		transcript_path: context.transcriptPath ?? "",
		cwd: context.cwd,
		hook_event_name: "PostToolUse",
		tool_input: request.toolInput,
	};
}
