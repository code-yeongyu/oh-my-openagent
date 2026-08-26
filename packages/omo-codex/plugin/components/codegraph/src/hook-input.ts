import { homedir } from "node:os";
import type { Readable } from "node:stream";

export function resolveHomeDir(env: Record<string, string | undefined>): string {
	return env["HOME"] ?? env["USERPROFILE"] ?? homedir();
}

export function resolveHookProjectRoot(input: unknown, fallback: string): string {
	if (!isRecord(input)) return fallback;
	const cwd = input["cwd"];
	return typeof cwd === "string" && cwd.trim().length > 0 ? cwd : fallback;
}

export async function readHookInput(stdin: Readable & { readonly isTTY?: boolean }): Promise<unknown> {
	if (stdin.isTTY === true) return undefined;
	let text = "";
	for await (const chunk of stdin) text += typeof chunk === "string" ? chunk : String(chunk);
	if (text.trim().length === 0) return undefined;
	return parseJson(text);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch (error) {
		if (error instanceof SyntaxError) return undefined;
		throw error;
	}
}
