import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	isContextOverflow,
	type Message,
	type Model,
	type TextContent,
} from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/compat";
import {
	type CompactionPreparation,
	type CompactionResult,
	DEFAULT_COMPACTION_SETTINGS,
	estimateContextTokens,
	estimateTokens,
	prepareCompaction,
	serializeConversation,
} from "../../../compaction/index.ts";
import { convertToLlm } from "../../../messages.ts";
import type { ModelRegistry } from "../../../model-registry.ts";
import type { ReadonlySessionManager } from "../../../session-manager.ts";
import type { ApplyCompactionResult, ContextUsage } from "../../types.ts";
import { computeEffectiveKeepRecentTokens, computeEffectiveThreshold } from "./policy.ts";
import { buildPrompt, type MergedCompactionPromptVariant } from "./prompts.ts";
import * as truncation from "./tool-truncation.ts";

const DEFAULT_CONTEXT_WINDOW = 200_000;
const COMPACTION_BUDGET_RATIO = 0.6;
const EMERGENCY_CONTEXT_TARGET_RATIO = 0.95;
const MAX_SUMMARY_TOKENS = 8192;
const SUMMARY_SCHEMA = "senpi.compaction.summary.v1";
type CompactionProgressCallback = (delta: string) => void;
type PruneStep = { messages: AgentMessage[]; removedTokens: number };

export interface SpeculativeCompactionContext {
	model: Model<any> | undefined;
	sessionManager: ReadonlySessionManager;
	modelRegistry?: ModelRegistry;
	getContextUsage(): ContextUsage | undefined;
	getCompactionSettings?(): CompactionPreparation["settings"];
	getMessageRevision(): number;
	applyCompaction(
		precomputed: CompactionResult,
		options: { reason: "extension"; expectedRevision: number },
	): Promise<ApplyCompactionResult>;
}

export interface SpeculativeCompactionSnapshot {
	generation: number;
	expectedRevision: number;
	model: Model<any>;
	contextWindow: number;
	preparation: CompactionPreparation;
	promptVariant: MergedCompactionPromptVariant;
	customInstructions?: string;
}

export type SpeculativeCompactionResult = ApplyCompactionResult | { applied: false; reason: "unavailable" };

function approxTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function getSummaryText(message: Message): string {
	const content = Array.isArray(message.content)
		? message.content
		: [{ type: "text" as const, text: message.content }];
	return content
		.filter((content): content is TextContent => content.type === "text")
		.map((content) => content.text)
		.join("\n")
		.trim();
}

function isAssistantMessage(message: Message): message is AssistantMessage {
	return message.role === "assistant" && "stopReason" in message;
}

async function generateSummaryMessage(options: {
	messages: AgentMessage[];
	onProgress?: CompactionProgressCallback;
	prompt: ReturnType<typeof buildPrompt>;
	signal?: AbortSignal;
	snapshot: SpeculativeCompactionSnapshot;
	auth: {
		apiKey: string;
		headers?: Record<string, string>;
		extraBody?: Record<string, unknown>;
	};
}): Promise<Message | undefined> {
	const conversationText = serializeConversation(convertToLlm(options.messages));
	const responseStream = stream(
		options.snapshot.model,
		{
			systemPrompt: options.prompt.system,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: `${options.prompt.user}\n\n<conversation>\n${conversationText}\n</conversation>`,
						},
					],
					timestamp: Date.now(),
				},
			],
		},
		{
			apiKey: options.auth.apiKey,
			headers: options.auth.headers,
			extraBody: options.auth.extraBody,
			maxTokens: MAX_SUMMARY_TOKENS,
			signal: options.signal,
		},
	);
	for await (const event of responseStream) {
		if (event.type === "text_delta" && event.delta) {
			options.onProgress?.(event.delta);
		}
	}
	return await responseStream.result();
}

function pruneToolResults(messages: AgentMessage[], contextWindow: number): AgentMessage[] {
	const toolResults = messages
		.filter((message) => message.role === "toolResult")
		.map((message) => ({ content: message.content, details: undefined }));
	if (toolResults.length === 0) return messages;

	const prunedResults = truncation.prePruneToolOutputsToBudget(toolResults, contextWindow * COMPACTION_BUDGET_RATIO);
	let resultIndex = 0;
	return messages.map((message) => {
		if (message.role !== "toolResult") return message;
		const pruned = prunedResults[resultIndex];
		resultIndex++;
		return pruned ? { ...message, content: pruned.content } : message;
	});
}

export function truncateContextMessages(messages: AgentMessage[]): AgentMessage[] {
	const toolResults = messages
		.filter((message) => message.role === "toolResult")
		.map((message) => ({ content: message.content, details: undefined }));
	if (toolResults.length === 0) return messages;

	const truncatedResults = truncation.truncateOversizedToolResults(toolResults);
	let resultIndex = 0;
	return messages.map((message) => {
		if (message.role !== "toolResult") return message;
		const truncated = truncatedResults[resultIndex];
		resultIndex++;
		return truncated ? { ...message, content: truncated.content } : message;
	});
}

function getToolCallIds(message: AgentMessage): Set<string> {
	const ids = new Set<string>();
	if (message.role !== "assistant") return ids;
	for (const block of message.content) {
		if (block.type === "toolCall") ids.add(block.id);
	}
	return ids;
}

function findLastUserLikeIndex(messages: AgentMessage[]): number {
	for (let index = messages.length - 1; index >= 0; index--) {
		const role = messages[index]?.role;
		if (role === "user" || role === "bashExecution") return index;
	}
	return messages.length;
}

function removeAssistantToolPair(messages: AgentMessage[], assistantIndex: number): PruneStep {
	const ids = getToolCallIds(messages[assistantIndex]);
	let removedTokens = 0;
	const pruned = messages.filter((message, index) => {
		const remove = index === assistantIndex || (message.role === "toolResult" && ids.has(message.toolCallId));
		if (remove) removedTokens += estimateTokens(message);
		return !remove;
	});
	return { messages: pruned, removedTokens };
}

function removeFirstOldToolPair(messages: AgentMessage[], boundaryIndex: number): PruneStep | undefined {
	for (let index = 0; index < boundaryIndex; index++) {
		const message = messages[index];
		if (!message) continue;
		if (message.role === "assistant" && getToolCallIds(message).size > 0)
			return removeAssistantToolPair(messages, index);
		if (message.role === "toolResult") {
			return {
				messages: messages.filter((_message, candidateIndex) => candidateIndex !== index),
				removedTokens: estimateTokens(message),
			};
		}
	}
	return undefined;
}

function removeFirstOldMessage(messages: AgentMessage[], boundaryIndex: number): PruneStep | undefined {
	for (let index = 0; index < boundaryIndex; index++) {
		const message = messages[index];
		if (!message || message.role === "toolResult") continue;
		if (message.role === "assistant" && getToolCallIds(message).size > 0)
			return removeAssistantToolPair(messages, index);
		return {
			messages: messages.filter((_candidate, candidateIndex) => candidateIndex !== index),
			removedTokens: estimateTokens(message),
		};
	}
	return undefined;
}

function pruneOldMessagesToBudget(messages: AgentMessage[], targetTokens: number): AgentMessage[] {
	let pruned = messages;
	let total = estimateTotalTokens(pruned);
	while (total > targetTokens) {
		const boundaryIndex = findLastUserLikeIndex(pruned);
		const next = removeFirstOldToolPair(pruned, boundaryIndex) ?? removeFirstOldMessage(pruned, boundaryIndex);
		if (!next || next.messages.length === pruned.length) break;
		pruned = next.messages;
		total -= next.removedTokens;
	}
	return pruned;
}

function removeOldestHistoryItemForOverflowRetry(messages: AgentMessage[]): AgentMessage[] | undefined {
	if (messages.length <= 1) return undefined;
	const boundaryIndex = findLastUserLikeIndex(messages);
	return (
		removeFirstOldToolPair(messages, boundaryIndex)?.messages ??
		removeFirstOldMessage(messages, boundaryIndex)?.messages ??
		(messages.length > 1 ? messages.slice(1) : undefined)
	);
}

function estimateTotalTokens(messages: AgentMessage[]): number {
	let total = 0;
	for (const message of messages) total += estimateTokens(message);
	return total;
}

export function hardLimitEmergencyPrune(
	messages: AgentMessage[],
	contextWindow: number,
): {
	messages: AgentMessage[];
	needsAggressiveCompaction: boolean;
} {
	const targetTokens = Math.floor(contextWindow * EMERGENCY_CONTEXT_TARGET_RATIO);
	const noLlmPruned = truncateContextMessages(pruneToolResults(messages, contextWindow));
	if (estimateTotalTokens(noLlmPruned) <= targetTokens) {
		return { messages: noLlmPruned, needsAggressiveCompaction: false };
	}
	return {
		messages: pruneOldMessagesToBudget(noLlmPruned, targetTokens),
		needsAggressiveCompaction: true,
	};
}

export function getPromptVariant(options: {
	reason: string;
	preparation: { previousSummary?: string; isSplitTurn: boolean };
}): MergedCompactionPromptVariant {
	if (options.reason === "branch") return "branch";
	if (options.preparation.previousSummary) return "update";
	if (options.preparation.isSplitTurn) return "turn_prefix";
	return "default";
}

export function createSpeculativeCompactionSnapshot(
	context: SpeculativeCompactionContext,
	options: { customInstructions?: string; generation: number },
): SpeculativeCompactionSnapshot | undefined {
	const model = context.model;
	if (!model) return undefined;

	const expectedRevision = context.getMessageRevision();
	const branchEntries = context.sessionManager.getBranch();
	const contextWindow = context.getContextUsage()?.contextWindow ?? model.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
	const settings = context.getCompactionSettings?.() ?? DEFAULT_COMPACTION_SETTINGS;
	const thresholdRatio = computeEffectiveThreshold(contextWindow);
	const preparation = prepareCompaction(branchEntries, {
		...settings,
		keepRecentTokens: computeEffectiveKeepRecentTokens(settings.keepRecentTokens, contextWindow, thresholdRatio),
	});
	if (!preparation) return undefined;

	return {
		generation: options.generation,
		expectedRevision,
		model,
		contextWindow,
		preparation,
		promptVariant: getPromptVariant({ reason: "extension", preparation }),
		customInstructions: options.customInstructions,
	};
}

export async function runExtensionCompaction(
	context: SpeculativeCompactionContext,
	snapshot: SpeculativeCompactionSnapshot,
	signal?: AbortSignal,
	onProgress?: CompactionProgressCallback,
): Promise<CompactionResult | undefined> {
	const auth = await context.modelRegistry?.getApiKeyAndHeaders(snapshot.model);
	if (!auth?.ok || !auth.apiKey) return undefined;

	let messages = pruneToolResults(
		[...snapshot.preparation.messagesToSummarize, ...snapshot.preparation.turnPrefixMessages],
		snapshot.contextWindow,
	);
	const prompt = buildPrompt({
		variant: snapshot.promptVariant,
		previousSummary: snapshot.preparation.previousSummary,
		customInstructions: snapshot.customInstructions,
	});

	while (true) {
		const response = await generateSummaryMessage({
			messages,
			onProgress,
			prompt,
			signal,
			snapshot,
			auth: {
				apiKey: auth.apiKey,
				headers: auth.headers,
				extraBody: auth.extraBody,
			},
		});
		if (!response) return undefined;

		if (isAssistantMessage(response) && isContextOverflow(response, snapshot.contextWindow)) {
			const retryMessages = removeOldestHistoryItemForOverflowRetry(messages);
			if (!retryMessages || retryMessages.length === messages.length) {
				break;
			}
			messages = retryMessages;
			continue;
		}

		const summary = getSummaryText(response);
		if (!summary) return undefined;

		const tokenEstimate = estimateContextTokens(convertToLlm(messages)).tokens + approxTokens(summary);
		if (tokenEstimate > snapshot.contextWindow * COMPACTION_BUDGET_RATIO) return undefined;

		return {
			summary,
			firstKeptEntryId: snapshot.preparation.firstKeptEntryId,
			tokensBefore: snapshot.preparation.tokensBefore,
			details: { schema: SUMMARY_SCHEMA, promptVariant: snapshot.promptVariant, tokenEstimate },
		};
	}

	throw new Error("Compaction summary request exceeded the context window after retrying with a smaller input");
}

export async function applyGeneratedCompaction(
	context: SpeculativeCompactionContext,
	snapshot: SpeculativeCompactionSnapshot | undefined,
	getCurrentGeneration: () => number,
	compaction: CompactionResult | undefined,
): Promise<SpeculativeCompactionResult> {
	if (!snapshot || !compaction) return { applied: false, reason: "unavailable" };

	if (snapshot.generation !== getCurrentGeneration() || snapshot.expectedRevision !== context.getMessageRevision()) {
		return { applied: false, reason: "stale" };
	}

	return await context.applyCompaction(compaction, {
		reason: "extension",
		expectedRevision: snapshot.expectedRevision,
	});
}

export async function applySpeculativeCompaction(
	context: SpeculativeCompactionContext,
	snapshot: SpeculativeCompactionSnapshot | undefined,
	getCurrentGeneration: () => number,
	generate: () => Promise<CompactionResult | undefined>,
): Promise<SpeculativeCompactionResult> {
	if (!snapshot) return { applied: false, reason: "unavailable" };

	const compaction = await generate();
	return await applyGeneratedCompaction(context, snapshot, getCurrentGeneration, compaction);
}
