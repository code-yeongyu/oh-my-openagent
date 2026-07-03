import type { IdMapper } from "./id-mapper.ts";
import type { StreamClass } from "./protocol-core.ts";

export type SemanticProjectionChannel =
	| "command"
	| "file"
	| "item"
	| "mcp"
	| "plan"
	| "process"
	| "raw-response"
	| "reasoning"
	| "reasoning-summary"
	| "text"
	| "turn";

export type SemanticProjectionType =
	| "completed"
	| "delta"
	| "item-completed"
	| "item-started"
	| "part-added"
	| "progress"
	| "turn-completed"
	| "turn-started";

export interface ProjectItemStreamInput {
	readonly method: string;
	readonly params: unknown;
	readonly sequence: number;
	readonly externalSessionId: string | undefined;
	readonly idMapper: IdMapper;
}

export interface SemanticItemStreamProjection {
	readonly kind: "semantic";
	readonly method: string;
	readonly sequence: number;
	readonly channel: SemanticProjectionChannel;
	readonly semanticType: SemanticProjectionType;
	readonly streamClass: StreamClass;
	readonly externalSessionId: string | undefined;
	readonly appThreadId: string | undefined;
	readonly appTurnId: string | undefined;
	readonly appItemId: string | undefined;
	readonly delta: string | undefined;
	readonly index: number | undefined;
	readonly completedItem: unknown;
	readonly originalParams: unknown;
}

interface ItemProjectionShape {
	readonly channel: SemanticProjectionChannel;
	readonly semanticType: SemanticProjectionType;
	readonly streamClass: StreamClass;
}

const itemProjectionShapes: Readonly<Record<string, ItemProjectionShape>> = {
	"item/started": { channel: "item", semanticType: "item-started", streamClass: "lossless" },
	"item/completed": { channel: "item", semanticType: "item-completed", streamClass: "lossless" },
	"rawResponseItem/completed": { channel: "raw-response", semanticType: "completed", streamClass: "lossless" },
	"item/agentMessage/delta": { channel: "text", semanticType: "delta", streamClass: "lossless" },
	"item/plan/delta": { channel: "plan", semanticType: "delta", streamClass: "lossless" },
	"item/reasoning/summaryTextDelta": { channel: "reasoning-summary", semanticType: "delta", streamClass: "lossless" },
	"item/reasoning/summaryPartAdded": {
		channel: "reasoning-summary",
		semanticType: "part-added",
		streamClass: "lossless",
	},
	"item/reasoning/textDelta": { channel: "reasoning", semanticType: "delta", streamClass: "lossless" },
	"command/exec/outputDelta": { channel: "command", semanticType: "progress", streamClass: "best-effort" },
	"item/commandExecution/outputDelta": { channel: "command", semanticType: "progress", streamClass: "best-effort" },
	"item/commandExecution/terminalInteraction": {
		channel: "command",
		semanticType: "progress",
		streamClass: "best-effort",
	},
	"process/outputDelta": { channel: "process", semanticType: "progress", streamClass: "best-effort" },
	"process/exited": { channel: "process", semanticType: "completed", streamClass: "lossless" },
	"item/fileChange/outputDelta": { channel: "file", semanticType: "progress", streamClass: "best-effort" },
	"item/fileChange/patchUpdated": { channel: "file", semanticType: "progress", streamClass: "best-effort" },
	"item/mcpToolCall/progress": { channel: "mcp", semanticType: "progress", streamClass: "best-effort" },
	"turn/started": { channel: "turn", semanticType: "turn-started", streamClass: "lossless" },
	"turn/completed": { channel: "turn", semanticType: "turn-completed", streamClass: "lossless" },
};

export function projectItemStreamNotification(input: ProjectItemStreamInput): SemanticItemStreamProjection | undefined {
	const shape = itemProjectionShapes[input.method];
	if (!shape) return undefined;

	const params = isRecord(input.params) ? input.params : {};
	const appThreadId = readAppThreadId(params);
	const appTurnId = readAppTurnId(params);
	const completedItem = readCompletedItem(input.method, params);
	const appItemId = readItemId(params, completedItem);
	const delta = readString(params, "delta");
	const index = readNumber(params, "index");

	if (input.method === "item/started" && appThreadId && appTurnId && appItemId) {
		registerItemIfNeeded(input.idMapper, {
			appThreadId,
			appTurnId,
			appItemId,
			itemKind: readItemKind(completedItem),
		});
	}

	return {
		kind: "semantic",
		method: input.method,
		sequence: input.sequence,
		channel: shape.channel,
		semanticType: shape.semanticType,
		streamClass: shape.streamClass,
		externalSessionId: input.externalSessionId,
		appThreadId,
		appTurnId,
		appItemId,
		delta,
		index,
		completedItem,
		originalParams: input.params,
	};
}

interface RegisterItemInput {
	readonly appThreadId: string;
	readonly appTurnId: string;
	readonly appItemId: string;
	readonly itemKind: string;
}

function registerItemIfNeeded(idMapper: IdMapper, input: RegisterItemInput): void {
	if (idMapper.getItem(input.appItemId)) return;
	idMapper.registerItem(input);
}

function readCompletedItem(method: string, params: Readonly<Record<string, unknown>>): unknown {
	if (method !== "item/started" && method !== "item/completed") return undefined;
	return params.item;
}

function readAppThreadId(params: Readonly<Record<string, unknown>>): string | undefined {
	return readString(params, "threadId") ?? readString(params, "thread_id");
}

function readAppTurnId(params: Readonly<Record<string, unknown>>): string | undefined {
	return readString(params, "turnId") ?? readString(params, "turn_id");
}

function readItemId(params: Readonly<Record<string, unknown>>, completedItem: unknown): string | undefined {
	const itemId = readString(params, "itemId") ?? readString(params, "item_id");
	if (itemId) return itemId;
	if (!isRecord(completedItem)) return undefined;
	return readString(completedItem, "id");
}

function readItemKind(item: unknown): string {
	if (!isRecord(item)) return "unknown";
	return readString(item, "type") ?? readString(item, "kind") ?? "unknown";
}

function readString(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
	const value = input[key];
	return typeof value === "string" ? value : undefined;
}

function readNumber(input: Readonly<Record<string, unknown>>, key: string): number | undefined {
	const value = input[key];
	return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
