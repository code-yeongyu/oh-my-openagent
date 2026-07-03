/** Permission action: allow (grant), deny (block), or ask (prompt user) */
export type Action = "allow" | "deny" | "ask";

/** A single permission rule with pattern matching */
export type Rule = {
	permission: string;
	pattern: string;
	action: Action;
};

/** Ordered list of rules for evaluation (last match wins) */
export type Ruleset = Rule[];

/** Configuration format for settings.json */
export type PermissionConfig = Record<string, Action | Record<string, Action>>;

export type PermissionPresetName = "full-access" | "workspace" | "read-only" | "ask";

/** User reply to a permission request */
export type Reply = "once" | "always" | "reject";

/** Final permission decision: user reply or auto-grant from rules */
export type PermissionDecision = Reply | "allow";

/** Permission request sent to user for approval */
export type Request = {
	id: string;
	sessionID: string;
	permission: string;
	patterns: string[];
	always: string[];
	metadata: Record<string, unknown>;
	tool?: {
		messageID: string;
		callID: string;
	};
};

/** Input for replying to a permission request */
export type ReplyInput = {
	requestID: string;
	reply: Reply;
	message?: string;
};

/** Error thrown when user rejects a permission request */
export class RejectedError extends Error {
	readonly _tag = "PermissionRejectedError";

	constructor() {
		super("The user rejected permission to use this specific tool call.");
		this.name = "RejectedError";
	}
}

/** Error thrown when user rejects with feedback for correction */
export class CorrectedError extends Error {
	readonly _tag = "PermissionCorrectedError";
	readonly feedback: string;

	constructor(feedback: string) {
		super(`The user rejected permission to use this specific tool call with the following feedback: ${feedback}`);
		this.name = "CorrectedError";
		this.feedback = feedback;
	}
}

/** Error thrown when a rule denies the permission */
export class DeniedError extends Error {
	readonly _tag = "PermissionDeniedError";
	readonly patterns: string[];

	constructor(patterns: string[]) {
		super(`The user has specified a rule which prevents you from using this specific tool call.`);
		this.name = "DeniedError";
		this.patterns = patterns;
	}
}

/** Union of all permission-related errors */
export type PermissionError = RejectedError | CorrectedError | DeniedError;

/** Internal pending request entry */
export type PendingEntry = {
	info: Request;
	resolve: () => void;
	reject: (err: RejectedError | CorrectedError) => void;
};
