import { parseUltragoalSteeringDirective, steerUltragoal } from "./steering.js";

export interface UserPromptSubmitPayload {
	readonly cwd: string;
	readonly hook_event_name: "UserPromptSubmit";
	readonly model?: string;
	readonly permission_mode?: string;
	readonly prompt: string;
	readonly session_id: string;
	readonly transcript_path?: string;
	readonly turn_id?: string;
}

export function parseUserPromptSubmitPayload(raw: string): UserPromptSubmitPayload | null {
	if (raw.trim().length === 0) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isUserPromptSubmitPayload(parsed) ? parsed : null;
	} catch (error) {
		if (error instanceof SyntaxError) return null;
		return null;
	}
}

export async function applyUserPromptUltragoalSteering(payload: UserPromptSubmitPayload): Promise<string> {
	try {
		if (payload.hook_event_name !== "UserPromptSubmit") return "";
		const proposal = parseUltragoalSteeringDirective(payload.prompt);
		if (proposal === null) return "";
		const result = await steerUltragoal(payload.cwd, proposal);
		if (!result.accepted) return "";
		return JSON.stringify({
			status: "accepted",
			kind: result.audit.kind,
			source: result.audit.source,
			deduped: result.deduped,
		});
	} catch (error) {
		if (error instanceof Error) return "";
		return "";
	}
}

export async function runUltragoalHookCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream): Promise<void> {
	try {
		const payload = parseUserPromptSubmitPayload(await readAll(stdin));
		if (payload === null) return;
		const output = await applyUserPromptUltragoalSteering(payload);
		if (output.length > 0) stdout.write(output);
	} catch (error) {
		if (error instanceof Error) return;
		return;
	}
}

function isUserPromptSubmitPayload(value: unknown): value is UserPromptSubmitPayload {
	if (!isRecord(value)) return false;
	return (
		value["hook_event_name"] === "UserPromptSubmit" &&
		typeof value["cwd"] === "string" &&
		typeof value["prompt"] === "string" &&
		typeof value["session_id"] === "string" &&
		["model", "permission_mode", "transcript_path", "turn_id"].every((key) => optionalString(value[key]))
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
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
