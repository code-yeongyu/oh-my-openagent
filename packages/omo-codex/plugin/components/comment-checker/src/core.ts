export { parseApplyPatchRequests } from "@oh-my-opencode/comment-checker-core";
export { toHookInput } from "./hook-input.js";
export { isRecord } from "@oh-my-opencode/comment-checker-core";
export { extractCommentCheckRequests, isToolFailureOutput } from "./request-extractor.js";
export type {
	CheckerEdit,
	CheckerToolInput,
	CheckerToolName,
	CommentCheckerHookInput,
	CommentCheckRequest,
	ImageContent,
	TextContent,
	ToolResultContent,
	ToolResultLike,
} from "./types.js";
