import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { CompactionResult } from "../../../compaction/index.ts";
import { convertToLlm } from "../../../messages.ts";
import type { CompactionEntry } from "../../../session-manager.ts";
import type { ContextUsage, ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent } from "../../types.ts";
import * as checkpointState from "./checkpoint-state.ts";
import * as breaker from "./circuit-breaker.ts";
import {
	BUILTIN_CONTEXT_REDUCTION_OPTIONS,
	reduceContextMessages,
	shouldApplyContextReduction,
} from "./context-reduction.ts";
import {
	createDegradationMonitorState,
	handleMessageEnd,
	handleTurnEnd,
	RECOVERY_INSTRUCTIONS,
	resetOnSessionCompact,
} from "./degradation-monitor.ts";
import {
	rewriteOpenAiPayloadWithRemoteCompaction,
	runOpenAiRemoteCompaction,
	SENPI_COMPACTION_EVENT,
} from "./openai-remote.ts";
import * as cap from "./per-turn-cap.ts";
import * as policy from "./policy.ts";
import { repairOrphanedToolResults } from "./repair-tool-pairs.ts";
import * as restoration from "./restoration-tracker.ts";
import {
	applyGeneratedCompaction,
	createSpeculativeCompactionSnapshot,
	getPromptVariant,
	hardLimitEmergencyPrune,
	runExtensionCompaction,
	type SpeculativeCompactionResult,
	type SpeculativeCompactionSnapshot,
} from "./speculative.ts";
import { type CompactionExtensionState, createInitialState, resetTurnCounter } from "./state.ts";
import * as todoBridge from "./todo-bridge.ts";
import * as truncation from "./tool-truncation.ts";

const DEFAULT_CONTEXT_WINDOW = 200_000;
const EMERGENCY_COMPACTION_INSTRUCTIONS =
	"EMERGENCY: hard context limit reached. Produce an aggressive recovery summary that preserves current goal, constraints, files touched, tool outcomes, and exact next steps. Prefer concise factual state over transcript detail.";
const PROACTIVE_COMPACTION_INSTRUCTIONS = "Proactively compact before the next agent turn.";
const MAX_PENDING_METADATA = 8;
const IMAGE_PROMPT_TOKEN_ESTIMATE = 1_200;

interface PendingCompactionMetadata {
	checkpoint: checkpointState.AgentCheckpoint;
	todoSnapshot: todoBridge.TodoSnapshotPayload;
}

function approxTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function isOpenAiResponsesModel(model: ExtensionContext["model"]): boolean {
	return model?.provider === "openai" && model.api === "openai-responses";
}

function estimatePendingPromptTokens(event: { prompt?: string; images?: readonly unknown[] }): number {
	return approxTokens(event.prompt ?? "") + (event.images?.length ?? 0) * IMAGE_PROMPT_TOKEN_ESTIMATE;
}

function withAdditionalTokens(usage: ContextUsage, additionalTokens: number): ContextUsage {
	if (usage.tokens === null || additionalTokens <= 0) return usage;
	const tokens = usage.tokens + additionalTokens;
	return {
		...usage,
		tokens,
		percent: usage.contextWindow > 0 ? (tokens / usage.contextWindow) * 100 : usage.percent,
	};
}

function isMonitorableMessageEvent(event: { message: AgentMessage }): event is {
	message: AgentMessage & { content: Array<{ type: string; text?: string }> };
} {
	return "content" in event.message && Array.isArray(event.message.content);
}

function isAbortedAssistantMessage(event: { message: AgentMessage }): boolean {
	return event.message.role === "assistant" && "stopReason" in event.message && event.message.stopReason === "aborted";
}

function updateLastYield(state: CompactionExtensionState, entry: CompactionEntry): CompactionExtensionState {
	const savedTokens = Math.max(0, entry.tokensBefore - approxTokens(entry.summary));
	return { ...state, lastYield: { savedTokens, tokensBefore: entry.tokensBefore } };
}

function recentCheckpoint(ctx: ExtensionContext): checkpointState.AgentCheckpoint | null {
	const checkpoint = checkpointState.getLatestCheckpoint(ctx);
	if (!checkpoint?.timestamp) return null;
	return Date.now() - checkpoint.timestamp <= 60_000 ? checkpoint : null;
}

function shouldEndFeedback(result: SpeculativeCompactionResult): boolean {
	return !result.applied && result.reason !== "rejected";
}

function endCompactionFeedback(
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
	result: SpeculativeCompactionResult,
): void {
	if (shouldEndFeedback(result)) {
		ctx.endCompaction?.({ reason: "extension", aborted: signal?.aborted });
	}
}

function linkAbortSignal(source: AbortSignal | undefined, target: AbortController): () => void {
	if (!source) return () => {};
	if (source.aborted) {
		target.abort();
		return () => {};
	}
	const abort = () => target.abort();
	source.addEventListener("abort", abort, { once: true });
	return () => source.removeEventListener("abort", abort);
}

function createBlockingRemoteCompactionEvent(
	ctx: ExtensionContext,
	snapshot: SpeculativeCompactionSnapshot,
	customInstructions: string,
	signal: AbortSignal,
): SessionBeforeCompactEvent {
	return {
		type: "session_before_compact",
		reason: "extension",
		willRetry: false,
		requestId: randomUUID(),
		preparation: snapshot.preparation,
		branchEntries: ctx.sessionManager.getBranch(),
		customInstructions,
		signal,
	};
}

export default function compactionExtension(pi: ExtensionAPI): void {
	let state: CompactionExtensionState = createInitialState();
	const degradationState = createDegradationMonitorState();
	const restorationState = state.restoration ?? restoration.createRestorationTrackerState();
	state = { ...state, restoration: restorationState };
	let speculativeGeneration = 0;
	let speculativeJob:
		| {
				generation: number;
				snapshot: SpeculativeCompactionSnapshot;
				controller: AbortController;
				promise: Promise<CompactionResult | undefined>;
		  }
		| undefined;
	const pendingMetadata = new Map<string, PendingCompactionMetadata>();

	function invalidateSpeculativeCompaction(): void {
		speculativeGeneration++;
		speculativeJob?.controller.abort();
		speculativeJob = undefined;
	}

	function startSpeculativeCompaction(ctx: ExtensionContext, customInstructions: string): void {
		if (speculativeJob) return;
		const generation = ++speculativeGeneration;
		const snapshot = createSpeculativeCompactionSnapshot(ctx, { generation, customInstructions });
		if (!snapshot) return;

		const controller = new AbortController();
		const promise = runExtensionCompaction(ctx, snapshot, controller.signal).catch(() => undefined);
		speculativeJob = { generation, snapshot, controller, promise };
	}

	function capturePendingMetadata(requestId: string, ctx: ExtensionContext): void {
		pendingMetadata.set(requestId, {
			checkpoint: checkpointState.captureAgentCheckpoint(pi, ctx),
			todoSnapshot: todoBridge.createTodoSnapshot(ctx),
		});
		while (pendingMetadata.size > MAX_PENDING_METADATA) {
			const oldestRequestId = pendingMetadata.keys().next().value;
			if (oldestRequestId === undefined) break;
			pendingMetadata.delete(oldestRequestId);
		}
	}

	function persistAcceptedMetadata(requestId: string): void {
		const metadata = pendingMetadata.get(requestId);
		if (!metadata) return;
		pendingMetadata.delete(requestId);
		checkpointState.persistCheckpoint(pi, metadata.checkpoint);
		todoBridge.persistTodoSnapshot(pi, metadata.todoSnapshot);
	}

	async function applyBlockingCompaction(
		ctx: ExtensionContext,
		customInstructions: string,
	): Promise<SpeculativeCompactionResult> {
		let feedbackSignal = ctx.beginCompaction?.({ reason: "extension" });
		try {
			if (isOpenAiResponsesModel(ctx.model)) {
				const remoteGeneration = speculativeGeneration + 1;
				const remoteSnapshot = createSpeculativeCompactionSnapshot(ctx, {
					generation: remoteGeneration,
					customInstructions,
				});
				if (remoteSnapshot) {
					const remoteSignal = feedbackSignal ?? new AbortController().signal;
					const remoteCompaction = await runOpenAiRemoteCompaction(
						ctx,
						createBlockingRemoteCompactionEvent(ctx, remoteSnapshot, customInstructions, remoteSignal),
						(data) => pi.events.emit(SENPI_COMPACTION_EVENT, data),
					);
					if (remoteCompaction) {
						if (speculativeGeneration !== remoteGeneration - 1) {
							const result = { applied: false, reason: "stale" } as const;
							endCompactionFeedback(ctx, feedbackSignal, result);
							return result;
						}
						speculativeGeneration = remoteGeneration;
						speculativeJob?.controller.abort();
						speculativeJob = undefined;
						const result = await applyGeneratedCompaction(
							ctx,
							remoteSnapshot,
							() => speculativeGeneration,
							remoteCompaction,
						);
						endCompactionFeedback(ctx, feedbackSignal, result);
						return result;
					}
				}
			}

			const pendingJob = speculativeJob;
			if (pendingJob) {
				const unlinkAbort = linkAbortSignal(feedbackSignal, pendingJob.controller);
				let compaction: CompactionResult | undefined;
				try {
					compaction = await pendingJob.promise;
				} finally {
					unlinkAbort();
				}
				const result = await applyGeneratedCompaction(
					ctx,
					pendingJob.snapshot,
					() => speculativeGeneration,
					compaction,
				);
				if (result.applied || result.reason === "stale") {
					speculativeJob = undefined;
					endCompactionFeedback(ctx, feedbackSignal, result);
					return result;
				}
				if (result.reason === "rejected") {
					feedbackSignal = ctx.beginCompaction?.({ reason: "extension" });
				}
				speculativeJob = undefined;
			}

			const generation = ++speculativeGeneration;
			const snapshot = createSpeculativeCompactionSnapshot(ctx, { generation, customInstructions });
			if (!snapshot) {
				const result = { applied: false, reason: "unavailable" } as const;
				endCompactionFeedback(ctx, feedbackSignal, result);
				return result;
			}
			const compaction = await runExtensionCompaction(ctx, snapshot, feedbackSignal, (delta) =>
				ctx.updateCompaction?.({ reason: "extension", delta }),
			);
			const result = await applyGeneratedCompaction(ctx, snapshot, () => speculativeGeneration, compaction);
			endCompactionFeedback(ctx, feedbackSignal, result);
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.endCompaction?.({
				reason: "extension",
				aborted: feedbackSignal?.aborted,
				errorMessage: `Compaction failed: ${message}`,
			});
			throw error;
		}
	}

	pi.on("session_before_compact", async (event, ctx) => {
		invalidateSpeculativeCompaction();
		if (cap.shouldRejectByCap(state, { reason: event.reason }).cancel) return { cancel: true };
		if (breaker.isTripped(state, Date.now()) && !breaker.shouldBypass(state, { reason: event.reason }))
			return { cancel: true };

		capturePendingMetadata(event.requestId, ctx);

		const model = ctx.model;
		if (!model) return undefined;
		const remoteCompaction = await runOpenAiRemoteCompaction(ctx, event, (data) =>
			pi.events.emit(SENPI_COMPACTION_EVENT, data),
		);
		if (remoteCompaction) {
			return { compaction: remoteCompaction };
		}

		const snapshot = {
			generation: ++speculativeGeneration,
			expectedRevision: ctx.getMessageRevision(),
			model,
			contextWindow: ctx.getContextUsage()?.contextWindow ?? model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
			preparation: event.preparation,
			promptVariant: getPromptVariant(event),
			customInstructions: event.customInstructions,
		};
		const compaction = await runExtensionCompaction(ctx, snapshot, event.signal, (delta) =>
			ctx.updateCompaction?.({ reason: event.reason, delta }),
		);
		if (!compaction) {
			pendingMetadata.delete(event.requestId);
			return { cancel: true };
		}

		return {
			compaction,
		};
	});

	pi.on("model_select", () => {
		invalidateSpeculativeCompaction();
	});

	pi.on("session_compact", async (event, ctx) => {
		invalidateSpeculativeCompaction();
		if (event.accepted) {
			persistAcceptedMetadata(event.requestId);
			const branchEntries = ctx.sessionManager.getBranch();
			const firstKeptIndex = branchEntries.findIndex((entry) => entry.id === event.compactionEntry.firstKeptEntryId);
			const keptEntries = firstKeptIndex === -1 ? [] : branchEntries.slice(firstKeptIndex);
			state = cap.incrementAccepted(state);
			state = breaker.recordSuccess(state);
			state = updateLastYield(state, event.compactionEntry);
			resetOnSessionCompact(degradationState);
			todoBridge.restoreTodosIfMissing(pi, ctx);
			const usage = ctx.getContextUsage();
			const settings = ctx.getCompactionSettings();
			if (settings.restorationEnabled ?? true) {
				restoration.preparePendingPayload(restorationState, {
					accepted: true,
					reason: event.reason,
					compactionEntryId: event.compactionEntry.id,
					contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
					usageTokens: usage?.tokens ?? null,
					reserveTokens: settings.reserveTokens,
					settings,
					keptMessages: keptEntries.flatMap((entry) => {
						if (entry.type !== "message") return [];
						return [entry.message];
					}),
				});
			}
			return;
		}
		state = breaker.recordFailure(state, Date.now(), { route: event.reason });
		ctx.ui.notify(`Compaction rejected: ${event.rejectionCause ?? "unknown"}`, "warning");
	});

	pi.on("before_agent_start", async (event, ctx) => {
		let systemPrompt = event.systemPrompt;
		const message = restoration.consumePendingPayload(restorationState);
		const checkpoint = recentCheckpoint(ctx);
		if (checkpoint) systemPrompt = checkpointState.injectRestorationDirective(systemPrompt, checkpoint);

		const usage = ctx.getContextUsage();
		const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
		const settings = ctx.getCompactionSettings();
		const pendingPromptTokens = estimatePendingPromptTokens(event);
		const usageWithPendingPrompt = usage ? withAdditionalTokens(usage, pendingPromptTokens) : undefined;
		if (usage && policy.isAtHardLimit(usage, contextWindow, settings.reserveTokens, pendingPromptTokens)) {
			await applyBlockingCompaction(ctx, EMERGENCY_COMPACTION_INSTRUCTIONS);
		} else if (
			usageWithPendingPrompt &&
			policy.shouldTriggerCompaction(usageWithPendingPrompt, contextWindow, settings, state.lastYield ?? undefined)
		) {
			await applyBlockingCompaction(ctx, PROACTIVE_COMPACTION_INSTRUCTIONS);
		} else if (
			usageWithPendingPrompt &&
			policy.shouldStartSpeculativeCompaction(
				usageWithPendingPrompt,
				contextWindow,
				settings,
				state.lastYield ?? undefined,
			)
		) {
			startSpeculativeCompaction(ctx, PROACTIVE_COMPACTION_INSTRUCTIONS);
		}

		if (systemPrompt === event.systemPrompt && !message) return undefined;
		return message ? { systemPrompt, message } : { systemPrompt };
	});

	pi.on("context", (event, ctx) => {
		const usage = ctx.getContextUsage();
		const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
		const sourceMessages = shouldApplyContextReduction({
			usageTokens: usage?.tokens ?? null,
			contextWindow,
			isProviderNativeCompactionPath: isOpenAiResponsesModel(ctx.model),
		})
			? reduceContextMessages(event.messages, BUILTIN_CONTEXT_REDUCTION_OPTIONS).messages
			: event.messages;
		const emergency = hardLimitEmergencyPrune(sourceMessages, contextWindow);
		return { messages: repairOrphanedToolResults(convertToLlm(emergency.messages)) };
	});

	pi.on("before_provider_request", (event, ctx) => {
		return rewriteOpenAiPayloadWithRemoteCompaction(
			event.payload,
			{ model: ctx.model, branchEntries: ctx.sessionManager.getBranch() },
			(data) => pi.events.emit(SENPI_COMPACTION_EVENT, data),
		);
	});

	pi.on("turn_end", async (_event, ctx) => {
		handleTurnEnd(degradationState);
		if (degradationState.recoveryTriggeredThisCycle) return;
		if (state.lastYield && state.lastYield.savedTokens <= 0) {
			void applyBlockingCompaction(ctx, RECOVERY_INSTRUCTIONS);
		}
	});

	pi.on("agent_end", () => {
		state = resetTurnCounter(state, "");
	});

	pi.on("message_end", async (event, ctx) => {
		if (isAbortedAssistantMessage(event)) {
			invalidateSpeculativeCompaction();
		}
		if (isMonitorableMessageEvent(event)) {
			await handleMessageEnd(degradationState, event, {
				applyCompaction: async (options) => {
					return await applyBlockingCompaction(ctx, options.customInstructions);
				},
				notify: (message) => ctx.ui.notify(message, "warning"),
			});
		}
	});

	pi.on("tool_result", (event) => {
		const [truncated] = truncation.truncateOversizedToolResults([{ content: event.content, details: event.details }]);
		return truncated ? { content: truncated.content, details: event.details, isError: event.isError } : undefined;
	});

	pi.on("tool_call", (event) => {
		restoration.trackToolCall(restorationState, event);
	});
}
