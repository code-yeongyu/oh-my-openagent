import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";

import {
	errorResponse,
	isPlainRecord,
	jsonRpcId,
	readStdioJsonRpcMessages,
	writeStdioJsonRpcResponse,
	type StdioJsonRpcResponseMode,
} from "../../../../../mcp-stdio-core/src/index.ts";
import type { CodegraphServeProcessOptions } from "./serve.js";
import { resolveServeProcessInvocation } from "./serve-invocation.js";

class CodegraphBridgeStdioError extends Error {
	override readonly name = "CodegraphBridgeStdioError";

	constructor(readonly streamName: string) {
		super(`CodeGraph MCP bridge missing child ${streamName}`);
	}
}

export async function runBridgedCodegraphProcess(
	command: string,
	args: readonly string[],
	options: CodegraphServeProcessOptions,
): Promise<number> {
	const invocation = resolveServeProcessInvocation(command, args);
	const child = spawn(invocation.command, invocation.args, {
		cwd: options.cwd,
		env: options.env,
		stdio: ["pipe", "pipe", "inherit"],
	});
	const childInput = child.stdin;
	const childOutput = child.stdout;
	if (childInput === null) throw new CodegraphBridgeStdioError("stdin");
	if (childOutput === null) throw new CodegraphBridgeStdioError("stdout");

	const responseModes = new Map<string, StdioJsonRpcResponseMode>();
	let defaultResponseMode: StdioJsonRpcResponseMode = "framed";
	const childExit = new Promise<number>((resolveExit, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code !== null) {
				resolveExit(code);
				return;
			}
			resolveExit(signal === null ? 0 : 1);
		});
	});
	const bridgeDone = Promise.all([
		forwardClientToCodegraph(options.input, childInput, responseModes, (mode) => {
			defaultResponseMode = mode;
		}),
		forwardCodegraphToClient(childOutput, options.output, responseModes, () => defaultResponseMode),
	]);
	const destroyChildPipes = (): void => {
		childInput.destroy();
		childOutput.destroy();
	};
	void childExit.then(destroyChildPipes, destroyChildPipes);
	return Promise.race([childExit, bridgeDone.then(() => childExit)]);
}

async function forwardClientToCodegraph(
	input: Readable,
	childInput: Writable,
	responseModes: Map<string, StdioJsonRpcResponseMode>,
	setDefaultResponseMode: (mode: StdioJsonRpcResponseMode) => void,
): Promise<void> {
	for await (const message of readStdioJsonRpcMessages(input)) {
		if (message.kind === "parse_error") {
			continue;
		}
		const responseMode = message.responseMode;
		setDefaultResponseMode(responseMode);
		const key = responseModeKey(message.payload);
		if (key !== null) responseModes.set(key, responseMode);
		await writeLine(childInput, JSON.stringify(message.payload));
	}
	childInput.end();
}

async function forwardCodegraphToClient(
	childOutput: Readable,
	output: Writable,
	responseModes: Map<string, StdioJsonRpcResponseMode>,
	defaultResponseMode: () => StdioJsonRpcResponseMode,
): Promise<void> {
	for await (const message of readStdioJsonRpcMessages(childOutput)) {
		if (message.kind === "parse_error") {
			writeStdioJsonRpcResponse(output, errorResponse(null, -32700, "Parse error", message.message), defaultResponseMode());
			continue;
		}
		const key = responseModeKey(message.payload);
		const responseMode = key === null ? defaultResponseMode() : (responseModes.get(key) ?? defaultResponseMode());
		if (key !== null) responseModes.delete(key);
		writeStdioJsonRpcResponse(output, message.payload, responseMode);
	}
}

function responseModeKey(payload: unknown): string | null {
	if (!isPlainRecord(payload) || !("id" in payload)) return null;
	const id = jsonRpcId(payload["id"]);
	return `${typeof id}:${String(id)}`;
}

async function writeLine(output: Writable, line: string): Promise<void> {
	if (output.write(`${line}\n`)) return;
	await new Promise<void>((resolveDrain, reject) => {
		output.once("drain", resolveDrain);
		output.once("error", reject);
	});
}
