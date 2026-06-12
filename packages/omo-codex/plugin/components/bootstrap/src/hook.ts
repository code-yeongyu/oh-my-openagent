import type { Readable } from "node:stream";

export interface SessionStartHookOptions {
	readonly env: NodeJS.ProcessEnv;
	readonly stdin: Readable & { readonly isTTY?: boolean };
}

export interface BootstrapHookContext {
	readonly payload: unknown;
	readonly pluginDataRoot: string | undefined;
	readonly pluginRoot: string | undefined;
}

export async function runSessionStartHook(options: SessionStartHookOptions): Promise<number> {
	await readBootstrapHookContext(options);
	return 0;
}

export async function readBootstrapHookContext({ env, stdin }: SessionStartHookOptions): Promise<BootstrapHookContext> {
	return {
		payload: parseJson(await readStream(stdin)),
		pluginDataRoot: env["PLUGIN_DATA"],
		pluginRoot: env["PLUGIN_ROOT"],
	};
}

async function readStream(stdin: SessionStartHookOptions["stdin"]): Promise<string> {
	if (stdin.isTTY === true) return "";
	const chunks: Buffer[] = [];
	for await (const chunk of stdin) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

function parseJson(raw: string): unknown {
	if (raw.trim().length === 0) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}
