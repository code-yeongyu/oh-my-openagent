import { handleLspMcpRequest, type JsonRpcResponse } from "@oh-my-opencode/lsp-core/mcp";
import { type RequestContext, runWithRequestContext } from "@oh-my-opencode/lsp-core/request-context";
import { isPlainRecord } from "@oh-my-opencode/mcp-stdio-core/record";

export const CONTEXT_KEY = "_context";

export interface RoutedRequest {
	input: unknown;
	context: RequestContext | undefined;
}

export function extractRequestContext(raw: unknown): RoutedRequest {
	if (!isPlainRecord(raw) || raw["method"] !== "tools/call") return { input: raw, context: undefined };
	const params = raw["params"];
	if (!isPlainRecord(params)) return { input: raw, context: undefined };
	const args = params["arguments"];
	if (!isPlainRecord(args)) return { input: raw, context: undefined };
	const context = parseContext(args[CONTEXT_KEY]);
	if (!context) return { input: raw, context: undefined };

	const cleanedArgs: Record<string, unknown> = { ...args };
	delete cleanedArgs[CONTEXT_KEY];
	const cleaned = { ...raw, params: { ...params, arguments: cleanedArgs } };
	return { input: cleaned, context };
}

export function handleDaemonMessage(raw: unknown): Promise<JsonRpcResponse | undefined> {
	const { input, context } = extractRequestContext(raw);
	if (context) return runWithRequestContext(context, () => handleLspMcpRequest(input));
	return handleLspMcpRequest(input);
}

function parseContext(value: unknown): RequestContext | undefined {
	if (!isPlainRecord(value)) return undefined;
	const context: RequestContext = {};
	const cwd = value["cwd"];
	if (typeof cwd === "string") context.cwd = cwd;
	const env = value["env"];
	if (isStringRecord(env)) context.env = env;
	return context.cwd === undefined && context.env === undefined ? undefined : context;
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return isPlainRecord(value) && Object.values(value).every((item) => typeof item === "string");
}
