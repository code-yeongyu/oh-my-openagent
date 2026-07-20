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

interface PendingClientResponse {
	readonly method: string | null;
	readonly responseMode: StdioJsonRpcResponseMode;
	readonly toolName: string | null;
}

const CODEGRAPH_NODE_DESCRIPTION =
	"Inspect one named symbol or file. In symbol mode, includeCode=true includes leaf-symbol source when available. Container symbols such as classes, interfaces, structs, enums, modules, and namespaces return structural outlines with member lists by design. For container source, request a specific member symbol or use file mode with symbolsOnly=false plus offset/limit.";

const CODEGRAPH_NODE_INCLUDE_CODE_DESCRIPTION =
	"Symbol mode: include leaf-symbol source when available. Container symbols such as classes, interfaces, structs, enums, modules, and namespaces intentionally return structural outlines with members; request a specific member symbol or use file mode with symbolsOnly=false plus offset/limit for source.";

const CODEGRAPH_CONTAINER_OUTLINE_GUIDANCE =
	"Container symbols intentionally return structural outlines with members. For source, request a specific member symbol or call codegraph_node in file mode with symbolsOnly=false plus offset/limit around the symbol location.";

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

	const pendingResponses = new Map<string, PendingClientResponse>();
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
	const clientForwardingDone = forwardClientToCodegraph(options.input, childInput, pendingResponses, (mode) => {
		defaultResponseMode = mode;
	});
	const responseForwardingDone = forwardCodegraphToClient(
		childOutput,
		options.output,
		pendingResponses,
		() => defaultResponseMode,
	);
	const bridgeDone = Promise.all([clientForwardingDone, responseForwardingDone]);
	const childAndResponsesDone = Promise.all([childExit, responseForwardingDone]).then(([exitCode]) => exitCode);
	const destroyChildPipes = (): void => {
		childInput.destroy();
		childOutput.destroy();
	};
	void childExit.then(destroyChildPipes, destroyChildPipes);
	try {
		return await Promise.race([childAndResponsesDone, bridgeDone.then(() => childExit)]);
	} catch (error) {
		destroyChildPipes();
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		await childExit.catch(() => undefined);
		throw error;
	}
}

async function forwardClientToCodegraph(
	input: Readable,
	childInput: Writable,
	pendingResponses: Map<string, PendingClientResponse>,
	setDefaultResponseMode: (mode: StdioJsonRpcResponseMode) => void,
): Promise<void> {
	for await (const message of readStdioJsonRpcMessages(input)) {
		if (message.kind === "parse_error") {
			continue;
		}
		const responseMode = message.responseMode;
		setDefaultResponseMode(responseMode);
		const key = responseModeKey(message.payload);
		if (key !== null) {
			pendingResponses.set(key, {
				method: jsonRpcMethod(message.payload),
				responseMode,
				toolName: jsonRpcToolName(message.payload),
			});
		}
		await writeLine(childInput, JSON.stringify(message.payload));
	}
	childInput.end();
}

async function forwardCodegraphToClient(
	childOutput: Readable,
	output: Writable,
	pendingResponses: Map<string, PendingClientResponse>,
	defaultResponseMode: () => StdioJsonRpcResponseMode,
): Promise<void> {
	for await (const message of readStdioJsonRpcMessages(childOutput)) {
		if (message.kind === "parse_error") {
			await writeStdioJsonRpcResponse(output, errorResponse(null, -32700, "Parse error", message.message), defaultResponseMode());
			continue;
		}
		const key = responseModeKey(message.payload);
		const pendingResponse = key === null ? undefined : pendingResponses.get(key);
		const responseMode = pendingResponse?.responseMode ?? defaultResponseMode();
		if (key !== null) pendingResponses.delete(key);
		await writeStdioJsonRpcResponse(output, clarifyCodegraphResponse(message.payload, pendingResponse), responseMode);
	}
}

function responseModeKey(payload: unknown): string | null {
	if (!isPlainRecord(payload) || !("id" in payload)) return null;
	const id = jsonRpcId(payload["id"]);
	return `${typeof id}:${String(id)}`;
}

function jsonRpcMethod(payload: unknown): string | null {
	if (!isPlainRecord(payload)) return null;
	const method = payload["method"];
	return typeof method === "string" ? method : null;
}

function jsonRpcToolName(payload: unknown): string | null {
	if (jsonRpcMethod(payload) !== "tools/call" || !isPlainRecord(payload)) return null;
	const params = payload["params"];
	if (!isPlainRecord(params)) return null;
	const name = params["name"];
	return typeof name === "string" ? name : null;
}

function clarifyCodegraphResponse(payload: unknown, pendingResponse: PendingClientResponse | undefined): unknown {
	if (pendingResponse?.method === "tools/list") return clarifyCodegraphToolsList(payload);
	if (pendingResponse?.method === "tools/call" && pendingResponse.toolName === "codegraph_node") {
		return clarifyCodegraphNodeCallResult(payload);
	}
	return payload;
}

function clarifyCodegraphToolsList(payload: unknown): unknown {
	if (!isPlainRecord(payload)) return payload;
	const result = payload["result"];
	if (!isPlainRecord(result) || !Array.isArray(result["tools"])) return payload;

	let changed = false;
	const tools = result["tools"].map((tool) => {
		if (!isPlainRecord(tool) || tool["name"] !== "codegraph_node") return tool;
		if (!hasCodegraphNodeContractMetadata(tool)) return tool;
		changed = true;
		return clarifyCodegraphNodeTool(tool);
	});
	if (!changed) return payload;
	return { ...payload, result: { ...result, tools } };
}

function clarifyCodegraphNodeTool(tool: Record<string, unknown>): Record<string, unknown> {
	const clarified: Record<string, unknown> = {
		...tool,
		description: CODEGRAPH_NODE_DESCRIPTION,
	};
	const inputSchema = tool["inputSchema"];
	if (isPlainRecord(inputSchema)) clarified["inputSchema"] = clarifyCodegraphNodeInputSchema(inputSchema);
	return clarified;
}

function hasCodegraphNodeContractMetadata(tool: Record<string, unknown>): boolean {
	if (typeof tool["description"] === "string") return true;
	const inputSchema = tool["inputSchema"];
	if (!isPlainRecord(inputSchema)) return false;
	const properties = inputSchema["properties"];
	return isPlainRecord(properties) && isPlainRecord(properties["includeCode"]);
}

function clarifyCodegraphNodeInputSchema(inputSchema: Record<string, unknown>): Record<string, unknown> {
	const properties = inputSchema["properties"];
	if (!isPlainRecord(properties)) return inputSchema;
	const includeCode = properties["includeCode"];
	if (!isPlainRecord(includeCode)) return inputSchema;
	return {
		...inputSchema,
		properties: {
			...properties,
			includeCode: {
				...includeCode,
				description: CODEGRAPH_NODE_INCLUDE_CODE_DESCRIPTION,
			},
		},
	};
}

function clarifyCodegraphNodeCallResult(payload: unknown): unknown {
	if (!isPlainRecord(payload)) return payload;
	const result = payload["result"];
	if (!isPlainRecord(result) || !Array.isArray(result["content"])) return payload;

	let changed = false;
	const content = result["content"].map((item) => {
		if (!isPlainRecord(item) || item["type"] !== "text" || typeof item["text"] !== "string") return item;
		const text = clarifyContainerOutlineGuidance(item["text"]);
		if (text === item["text"]) return item;
		changed = true;
		return { ...item, text };
	});
	if (!changed) return payload;
	return { ...payload, result: { ...result, content } };
}

function clarifyContainerOutlineGuidance(text: string): string {
	if (!text.includes("Structural outline only")) return text;
	return text.replace(/Structural outline only[^\n]*(?:\n[^\n]*(?:Read|read)[^\n]*)?/g, CODEGRAPH_CONTAINER_OUTLINE_GUIDANCE);
}

async function writeLine(output: Writable, line: string): Promise<void> {
	if (output.write(`${line}\n`)) return;
	await new Promise<void>((resolveDrain, reject) => {
		output.once("drain", resolveDrain);
		output.once("error", reject);
	});
}
