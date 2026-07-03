const SYNTHETIC_OUTPUT = "Tool output unavailable (interrupted before result)";

type ResponsesPayload = Record<string, unknown> & { input: unknown[] };
type ResponsesItem = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function hasResponsesInput(value: unknown): value is ResponsesPayload {
	return isObject(value) && Array.isArray(value.input);
}

function getType(item: unknown): string | undefined {
	return isObject(item) && typeof item.type === "string" ? item.type : undefined;
}

function getCallId(item: unknown): string | undefined {
	if (!isObject(item) || typeof item.call_id !== "string" || item.call_id.length === 0) return undefined;
	return item.call_id;
}

function isFunctionCallItem(item: unknown): item is ResponsesItem {
	const type = getType(item);
	return type === "function_call" || type === "local_shell_call";
}

function isFunctionCallOutputItem(item: unknown): item is ResponsesItem {
	return getType(item) === "function_call_output";
}

function isCustomToolCallItem(item: unknown): item is ResponsesItem {
	return getType(item) === "custom_tool_call";
}

function isCustomToolCallOutputItem(item: unknown): item is ResponsesItem {
	return getType(item) === "custom_tool_call_output";
}

function getCustomToolName(item: ResponsesItem): string | undefined {
	return typeof item.name === "string" && item.name.length > 0 ? item.name : undefined;
}

function collectMatchedOutputIds(input: unknown[]): {
	functionOutputIds: Set<string>;
	customOutputIds: Set<string>;
} {
	const seenFunctionCallIds = new Set<string>();
	const seenCustomCallIds = new Set<string>();
	const functionOutputIds = new Set<string>();
	const customOutputIds = new Set<string>();

	for (const item of input) {
		const callId = getCallId(item);
		if (!callId) continue;

		if (isFunctionCallItem(item)) {
			seenFunctionCallIds.add(callId);
			continue;
		}

		if (isCustomToolCallItem(item)) {
			seenCustomCallIds.add(callId);
			continue;
		}

		if (isFunctionCallOutputItem(item) && seenFunctionCallIds.has(callId) && !functionOutputIds.has(callId)) {
			functionOutputIds.add(callId);
			continue;
		}

		if (isCustomToolCallOutputItem(item) && seenCustomCallIds.has(callId) && !customOutputIds.has(callId)) {
			customOutputIds.add(callId);
		}
	}

	return { functionOutputIds, customOutputIds };
}

function createSyntheticFunctionOutput(callId: string): ResponsesItem {
	return {
		type: "function_call_output",
		call_id: callId,
		output: SYNTHETIC_OUTPUT,
	};
}

function createSyntheticCustomToolOutput(callId: string, callItem: ResponsesItem): ResponsesItem {
	const name = getCustomToolName(callItem);
	return {
		type: "custom_tool_call_output",
		call_id: callId,
		...(name ? { name } : {}),
		output: SYNTHETIC_OUTPUT,
	};
}

/** Repairs OpenAI Responses request input by keeping tool call/output pairs balanced. */
export function sanitizeOpenAIResponsesPayload(payload: unknown): unknown {
	if (!hasResponsesInput(payload)) return payload;
	// Output-only deltas are valid when server-side continuation is explicitly referenced.
	if (typeof payload.previous_response_id === "string" && payload.previous_response_id.length > 0) return payload;

	const { functionOutputIds, customOutputIds } = collectMatchedOutputIds(payload.input);
	const sanitizedInput: unknown[] = [];
	const emittedFunctionOutputIds = new Set<string>();
	const emittedCustomOutputIds = new Set<string>();
	let changed = false;

	for (const item of payload.input) {
		const callId = getCallId(item);

		if (isFunctionCallOutputItem(item)) {
			if (!callId || !functionOutputIds.has(callId) || emittedFunctionOutputIds.has(callId)) {
				changed = true;
				continue;
			}
			emittedFunctionOutputIds.add(callId);
			sanitizedInput.push(item);
			continue;
		}

		if (isCustomToolCallOutputItem(item)) {
			if (!callId || !customOutputIds.has(callId) || emittedCustomOutputIds.has(callId)) {
				changed = true;
				continue;
			}
			emittedCustomOutputIds.add(callId);
			sanitizedInput.push(item);
			continue;
		}

		sanitizedInput.push(item);

		if (callId && isFunctionCallItem(item) && !functionOutputIds.has(callId)) {
			sanitizedInput.push(createSyntheticFunctionOutput(callId));
			changed = true;
			continue;
		}

		if (callId && isCustomToolCallItem(item) && !customOutputIds.has(callId)) {
			sanitizedInput.push(createSyntheticCustomToolOutput(callId, item));
			changed = true;
		}
	}

	if (!changed) return payload;
	return { ...payload, input: sanitizedInput };
}
