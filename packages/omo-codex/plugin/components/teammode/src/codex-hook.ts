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
	const threadId = extractThreadId(payload.tool_response);
	if (threadId === null) return "";
	const output: PostToolUseHookOutput = {
		hookSpecificOutput: {
			hookEventName: "PostToolUse",
			additionalContext: threadTitleReminder(threadId, payload.tool_input),
		},
	};
	return `${JSON.stringify(output)}\n`;
}

export async function runTeammodeHookCli(
	stdin: NodeJS.ReadableStream,
	stdout: NodeJS.WritableStream,
): Promise<void> {
	try {
		const payload = parsePostToolUsePayload(await readAll(stdin));
		if (payload === null) return;
		const output = runPostToolUseHook(payload);
		if (output.length > 0) stdout.write(output);
	} catch (error) {
		if (error instanceof Error) return;
		return;
	}
}

function threadTitleReminder(threadId: string, toolInput: unknown): string {
	const promptSummary = extractPromptSummary(toolInput);
	const reminder = [
		`codex_app.create_thread created thread ${threadId}.`,
		"Call codex_app.set_thread_title immediately for that thread before doing any other follow-up work.",
		"Use a concise, descriptive title that reflects the thread's concrete task or team role, not a generic auto-generated title.",
	];
	if (promptSummary !== null) {
		reminder.push(`Base the title on this thread's actual assignment: ${promptSummary}`);
	}
	reminder.push("Do not leave the new thread with a vague default title.");
	return reminder.join(" ");
}

function extractPromptSummary(toolInput: unknown): string | null {
	if (!isRecord(toolInput)) return null;
	const prompt = toolInput["prompt"];
	if (typeof prompt !== "string") return null;
	const normalized = prompt.replace(/\s+/g, " ").trim();
	if (normalized.length === 0) return null;
	return normalized.length <= 160 ? normalized : `${normalized.slice(0, 157)}...`;
}

function extractThreadId(toolResponse: unknown): string | null {
	if (!isRecord(toolResponse)) return null;
	const threadId = toolResponse["threadId"];
	return typeof threadId === "string" && threadId.trim().length > 0 ? threadId : null;
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
