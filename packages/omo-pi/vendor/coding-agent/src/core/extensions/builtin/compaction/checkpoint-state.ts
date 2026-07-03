import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "../../types.ts";

const CHECKPOINT_CUSTOM_TYPE = "compaction.agent-checkpoint";
const CHECKPOINT_SCHEMA = "senpi.compaction.agent-checkpoint.v1";
const RESTORATION_DIRECTIVE = "[restore checkpointed session agent configuration after compaction]";

export interface AgentCheckpoint {
	activeTools?: string[];
	thinkingLevel?: ThinkingLevel | null;
	modelId?: string | undefined;
	agentName?: string | null;
	timestamp?: number;
	model?: {
		provider: string;
		modelId: string;
	};
}

interface PersistedCheckpointPayload {
	schema: typeof CHECKPOINT_SCHEMA;
	data: AgentCheckpoint;
}

interface LegacyCaptureInput {
	agentName?: string;
	model?: {
		provider: string;
		modelId: string;
	};
	activeTools?: string[];
}

interface AppendEntryTarget {
	appendEntry<T = unknown>(customType: string, data?: T): void;
}

interface LegacyCheckpointSource {
	persistedCheckpoints?: AgentCheckpoint[];
	appendCalls?: Array<{ customType: string; data: unknown }>;
}

function isExtensionAPI(value: ExtensionAPI | LegacyCaptureInput): value is ExtensionAPI {
	return "getActiveTools" in value && "getThinkingLevel" in value;
}

function deriveAgentName(ctx: ExtensionContext): string | null {
	for (let index = ctx.sessionManager.getEntries().length - 1; index >= 0; index--) {
		const entry = ctx.sessionManager.getEntries()[index];
		if (entry.type !== "custom") continue;
		const data = entry.data;
		if (isRecord(data) && typeof data.agentName === "string") {
			return data.agentName;
		}
		if (isRecord(data) && typeof data.agent === "string") {
			return data.agent;
		}
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseCheckpoint(value: unknown): AgentCheckpoint | null {
	if (!isRecord(value)) return null;
	if (value.schema === CHECKPOINT_SCHEMA && isRecord(value.data)) {
		return parseCheckpoint(value.data);
	}

	const activeTools = Array.isArray(value.activeTools)
		? value.activeTools.filter((tool): tool is string => typeof tool === "string")
		: [];
	const model = isRecord(value.model)
		? {
				provider: typeof value.model.provider === "string" ? value.model.provider : "",
				modelId: typeof value.model.modelId === "string" ? value.model.modelId : "",
			}
		: undefined;

	return {
		activeTools,
		thinkingLevel: typeof value.thinkingLevel === "string" ? (value.thinkingLevel as ThinkingLevel) : null,
		modelId: typeof value.modelId === "string" ? value.modelId : model?.modelId,
		agentName: typeof value.agentName === "string" ? value.agentName : null,
		timestamp: typeof value.timestamp === "number" ? value.timestamp : undefined,
		model,
	};
}

function serializeCheckpoint(checkpoint: AgentCheckpoint): PersistedCheckpointPayload & AgentCheckpoint {
	return {
		...checkpoint,
		schema: CHECKPOINT_SCHEMA,
		data: checkpoint,
	};
}

export function captureAgentCheckpoint(pi: ExtensionAPI, ctx: ExtensionContext): AgentCheckpoint;
export function captureAgentCheckpoint(input: LegacyCaptureInput): AgentCheckpoint;
export function captureAgentCheckpoint(
	piOrInput: ExtensionAPI | LegacyCaptureInput,
	ctx?: ExtensionContext,
): AgentCheckpoint {
	if (isExtensionAPI(piOrInput) && ctx) {
		return {
			activeTools: piOrInput.getActiveTools(),
			thinkingLevel: piOrInput.getThinkingLevel(),
			modelId: ctx.model?.id,
			agentName: deriveAgentName(ctx),
			timestamp: Date.now(),
			model: ctx.model ? { provider: ctx.model.provider, modelId: ctx.model.id } : undefined,
		};
	}

	const input = piOrInput as LegacyCaptureInput;
	return {
		activeTools: input.activeTools ?? [],
		thinkingLevel: null,
		modelId: input.model?.modelId,
		agentName: input.agentName ?? null,
		timestamp: Date.now(),
		model: input.model,
	};
}

export function persistCheckpoint(pi: ExtensionAPI, checkpoint: AgentCheckpoint): void;
export function persistCheckpoint(checkpoint: AgentCheckpoint, pi: AppendEntryTarget): void;
export function persistCheckpoint(
	piOrCheckpoint: ExtensionAPI | AgentCheckpoint,
	checkpointOrPi: AgentCheckpoint | AppendEntryTarget,
): void {
	if ("appendEntry" in piOrCheckpoint) {
		const checkpoint = checkpointOrPi as AgentCheckpoint;
		piOrCheckpoint.appendEntry(CHECKPOINT_CUSTOM_TYPE, serializeCheckpoint(checkpoint));
		return;
	}

	const pi = checkpointOrPi as AppendEntryTarget;
	pi.appendEntry(CHECKPOINT_CUSTOM_TYPE, serializeCheckpoint(piOrCheckpoint));
}

export function getLatestCheckpoint(ctx: ExtensionContext): AgentCheckpoint | null;
export function getLatestCheckpoint(source: LegacyCheckpointSource): AgentCheckpoint | undefined;
export function getLatestCheckpoint(
	source: ExtensionContext | LegacyCheckpointSource,
): AgentCheckpoint | null | undefined {
	if ("sessionManager" in source) {
		const entries = source.sessionManager.getEntries();
		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index];
			if (entry.type !== "custom" || entry.customType !== CHECKPOINT_CUSTOM_TYPE) continue;
			const checkpoint = parseCheckpoint(entry.data);
			if (checkpoint) return checkpoint;
		}
		return null;
	}

	const checkpoints = source.persistedCheckpoints ?? [];
	if (checkpoints.length > 0) {
		return [...checkpoints].sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0))[0];
	}

	const appended = source.appendCalls
		?.filter((call) => call.customType === CHECKPOINT_CUSTOM_TYPE)
		.map((call) => parseCheckpoint(call.data))
		.filter((checkpoint): checkpoint is AgentCheckpoint => checkpoint !== null);
	return appended?.sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0))[0];
}

function buildRestorationHints(checkpoint: AgentCheckpoint): string {
	const modelId = checkpoint.modelId ?? checkpoint.model?.modelId;
	const lines = [
		RESTORATION_DIRECTIVE,
		"",
		"Restore checkpointed session configuration:",
		`- Agent: ${checkpoint.agentName ?? "unknown"}`,
		`- Tools: ${checkpoint.activeTools && checkpoint.activeTools.length > 0 ? checkpoint.activeTools.join(", ") : "none"}`,
		`- Model: ${modelId ?? "unknown"}`,
	];
	return lines.join("\n");
}

export function injectRestorationDirective(systemPrompt: string, checkpoint: AgentCheckpoint): string;
export function injectRestorationDirective(
	checkpoint?: AgentCheckpoint,
	fallback?: { model?: { provider: string; modelId: string } },
): string;
export function injectRestorationDirective(
	systemPromptOrCheckpoint?: string | AgentCheckpoint,
	checkpointOrFallback?: AgentCheckpoint | { model?: { provider: string; modelId: string } },
): string {
	if (typeof systemPromptOrCheckpoint === "string") {
		const checkpoint = checkpointOrFallback as AgentCheckpoint;
		return `${systemPromptOrCheckpoint}\n\n${buildRestorationHints(checkpoint)}`;
	}

	if (checkpointOrFallback && "model" in checkpointOrFallback && checkpointOrFallback.model) {
		return `${RESTORATION_DIRECTIVE}\nModel: ${checkpointOrFallback.model.modelId}`;
	}

	return RESTORATION_DIRECTIVE;
}
