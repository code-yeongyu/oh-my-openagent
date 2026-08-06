export interface PostToolUsePayload {
	readonly hook_event_name: "PostToolUse";
	readonly session_id: string;
	readonly turn_id?: string;
	readonly transcript_path?: string | null;
	readonly cwd?: string;
	readonly model?: string;
	readonly permission_mode?: string;
	readonly tool_name: string;
	readonly tool_use_id?: string;
	readonly tool_input: unknown;
	readonly tool_response: unknown;
}

interface PostToolUseHookOutput {
	readonly hookSpecificOutput: {
		readonly hookEventName: "PostToolUse";
		readonly additionalContext: string;
	};
}

type ThreadCreationReference =
	| { readonly kind: "thread"; readonly id: string }
	| { readonly kind: "pendingWorktree"; readonly id: string };

const CREATE_THREAD_TOOL_NAMES = new Set(["create_thread", "codex_app.create_thread"]);

export function parsePostToolUsePayload(raw: string): PostToolUsePayload | null {
	if (raw.trim().length === 0) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isPostToolUsePayload(parsed) ? parsed : null;
	} catch (error) {
		if (error instanceof SyntaxError) return null;
		return null;
	}
}

export function runPostToolUseHook(payload: PostToolUsePayload): string {
	if (payload.hook_event_name !== "PostToolUse") return "";
	if (!CREATE_THREAD_TOOL_NAMES.has(payload.tool_name)) return "";
	const threadReference = extractThreadCreationReference(payload.tool_response);
	if (threadReference === null) return "";
	const output: PostToolUseHookOutput = {
		hookSpecificOutput: {
			hookEventName: "PostToolUse",
			additionalContext: threadTitleReminder(threadReference),
		},
	};
	return `${JSON.stringify(output)}\n`;
}

export async function runTeammodeHookCli(
	stdin: NodeJS.ReadableStream,
	stdout: NodeJS.WritableStream,
): Promise<void> {
	const payload = parsePostToolUsePayload(await readAll(stdin));
	if (payload === null) return;
	const output = runPostToolUseHook(payload);
	if (output.length > 0) stdout.write(output);
}

function threadTitleReminder(threadReference: ThreadCreationReference): string {
	const id = formatIdentifier(threadReference.id);
	return threadReference.kind === "thread"
		? `THREAD ID ${id}: CALL codex_app.set_thread_title NOW. USE THE REAL TASK/ROLE.`
		: `PENDING WORKTREE ID ${id}: WORKTREE THREAD IS NOT READY YET. DO NOT bind-thread OR SEND THE MEMBER BOOTSTRAP UNTIL A REAL THREAD ID EXISTS. THEN CALL codex_app.set_thread_title USING THE REAL TASK/ROLE.`;
}

function formatIdentifier(value: string): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length <= 200 ? normalized : `${normalized.slice(0, 197)}...`;
}

function extractThreadCreationReference(toolResponse: unknown): ThreadCreationReference | null {
	const response = parseToolResponseRecord(toolResponse);
	if (response === null) return null;
	const threadId = response["threadId"];
	if (typeof threadId === "string" && threadId.trim().length > 0) {
		return { kind: "thread", id: threadId };
	}
	const pendingWorktreeId = response["pendingWorktreeId"];
	if (typeof pendingWorktreeId === "string" && pendingWorktreeId.trim().length > 0) {
		return { kind: "pendingWorktree", id: pendingWorktreeId };
	}
	return null;
}

function parseToolResponseRecord(toolResponse: unknown): Record<string, unknown> | null {
	if (isRecord(toolResponse)) return toolResponse;
	if (typeof toolResponse !== "string") return null;
	const trimmed = toolResponse.trim();
	if (trimmed.length === 0) return null;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		return isRecord(parsed) ? parsed : null;
	} catch (error) {
		if (error instanceof SyntaxError) return null;
		return null;
	}
}

function isPostToolUsePayload(value: unknown): value is PostToolUsePayload {
	if (!isRecord(value)) return false;
	return (
		value["hook_event_name"] === "PostToolUse" &&
		typeof value["session_id"] === "string" &&
		typeof value["tool_name"] === "string" &&
		Object.hasOwn(value, "tool_input") &&
		Object.hasOwn(value, "tool_response") &&
		optionalString(value["turn_id"]) &&
		optionalString(value["cwd"]) &&
		optionalString(value["model"]) &&
		optionalString(value["permission_mode"]) &&
		optionalString(value["tool_use_id"]) &&
		(value["transcript_path"] === undefined ||
			value["transcript_path"] === null ||
			typeof value["transcript_path"] === "string")
	);
}

function optionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readAll(stdin: NodeJS.ReadableStream): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = "";
		stdin.setEncoding("utf8");
		stdin.on("data", (chunk: unknown) => {
			data += chunk instanceof Buffer ? chunk.toString() : String(chunk);
		});
		stdin.once("error", reject);
		stdin.once("end", () => resolve(data));
	});
}
