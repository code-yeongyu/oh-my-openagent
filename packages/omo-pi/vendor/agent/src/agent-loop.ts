/**
 * Agent loop that works with AgentMessage throughout.
 * Transforms to Message[] only at the LLM call boundary.
 */

import {
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
	EventStream,
	type ToolResultMessage,
	validateToolArguments,
} from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import type {
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentMessage,
	AgentTool,
	AgentToolCall,
	AgentToolResult,
	StreamFn,
} from "./types.ts";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

/**
 * Start an agent loop with a new prompt message.
 * The prompt is added to the context and events are emitted for it.
 */
export function agentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	const stream = createAgentStream();

	void runAgentLoop(
		prompts,
		context,
		config,
		async (event) => {
			stream.push(event);
		},
		signal,
		streamFn,
	).then((messages) => {
		stream.end(messages);
	});

	return stream;
}

/**
 * Continue an agent loop from the current context without adding a new message.
 * Used for retries - context already has user message or tool results.
 *
 * **Important:** The last message in context must convert to a `user` or `toolResult` message
 * via `convertToLlm`. If it doesn't, the LLM provider will reject the request.
 * This cannot be validated here since `convertToLlm` is only called once per turn.
 */
export function agentLoopContinue(
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	if (context.messages.length === 0) {
		throw new Error("Cannot continue: no messages in context");
	}

	if (context.messages[context.messages.length - 1].role === "assistant") {
		throw new Error("Cannot continue from message role: assistant");
	}

	const stream = createAgentStream();

	void runAgentLoopContinue(
		context,
		config,
		async (event) => {
			stream.push(event);
		},
		signal,
		streamFn,
	).then((messages) => {
		stream.end(messages);
	});

	return stream;
}

export async function runAgentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	emit: AgentEventSink,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): Promise<AgentMessage[]> {
	const newMessages: AgentMessage[] = [...prompts];
	const currentContext: AgentContext = {
		...context,
		messages: [...context.messages, ...prompts],
	};

	await emit({ type: "agent_start" });
	await emit({ type: "turn_start" });
	for (const prompt of prompts) {
		await emit({ type: "message_start", message: prompt });
		await emit({ type: "message_end", message: prompt });
	}

	await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
	return newMessages;
}

export async function runAgentLoopContinue(
	context: AgentContext,
	config: AgentLoopConfig,
	emit: AgentEventSink,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): Promise<AgentMessage[]> {
	if (context.messages.length === 0) {
		throw new Error("Cannot continue: no messages in context");
	}

	if (context.messages[context.messages.length - 1].role === "assistant") {
		throw new Error("Cannot continue from message role: assistant");
	}

	const newMessages: AgentMessage[] = [];
	const currentContext: AgentContext = { ...context };

	await emit({ type: "agent_start" });
	await emit({ type: "turn_start" });

	await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
	return newMessages;
}

function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
	return new EventStream<AgentEvent, AgentMessage[]>(
		(event: AgentEvent) => event.type === "agent_end",
		(event: AgentEvent) => (event.type === "agent_end" ? event.messages : []),
	);
}

const EMPTY_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
} satisfies AssistantMessage["usage"];

class StreamIdleTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`Idle timeout waiting for provider stream after ${timeoutMs}ms`);
		this.name = "StreamIdleTimeoutError";
	}
}

/**
 * Main loop logic shared by agentLoop and agentLoopContinue.
 */
async function runLoop(
	initialContext: AgentContext,
	newMessages: AgentMessage[],
	initialConfig: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	streamFn?: StreamFn,
): Promise<void> {
	let currentContext = initialContext;
	let config = initialConfig;
	let firstTurn = true;
	// Check for steering messages at start (user may have typed while waiting)
	let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

	// Outer loop: continues when queued follow-up messages arrive after agent would stop
	while (true) {
		let hasMoreToolCalls = true;

		// Inner loop: process tool calls and steering messages
		while (hasMoreToolCalls || pendingMessages.length > 0) {
			if (!firstTurn) {
				await emit({ type: "turn_start" });
			} else {
				firstTurn = false;
			}

			// Process pending messages (inject before next assistant response)
			if (pendingMessages.length > 0) {
				for (const message of pendingMessages) {
					await emit({ type: "message_start", message });
					await emit({ type: "message_end", message });
					currentContext.messages.push(message);
					newMessages.push(message);
				}
				pendingMessages = [];
			}

			// Stream assistant response
			const message = await streamAssistantResponse(currentContext, config, signal, emit, streamFn);
			newMessages.push(message);

			if (message.stopReason === "error" || message.stopReason === "aborted") {
				await emit({ type: "turn_end", message, toolResults: [] });
				await emit({ type: "agent_end", messages: newMessages });
				return;
			}

			// Check for tool calls
			const toolCalls = message.content.filter((c) => c.type === "toolCall");

			const toolResults: ToolResultMessage[] = [];
			hasMoreToolCalls = false;
			if (toolCalls.length > 0) {
				const executedToolBatch = await executeToolCalls(currentContext, message, config, signal, emit);
				toolResults.push(...executedToolBatch.messages);
				hasMoreToolCalls = !executedToolBatch.terminate;

				for (const result of toolResults) {
					currentContext.messages.push(result);
					newMessages.push(result);
				}
			}

			await emit({ type: "turn_end", message, toolResults });
			if (signal?.aborted) {
				await emit({ type: "agent_end", messages: newMessages });
				return;
			}

			const nextTurnContext = {
				message,
				toolResults,
				context: currentContext,
				newMessages,
			};
			const nextTurnSnapshot = await config.prepareNextTurn?.(nextTurnContext);
			if (nextTurnSnapshot) {
				currentContext = nextTurnSnapshot.context ?? currentContext;
				config = {
					...config,
					model: nextTurnSnapshot.model ?? config.model,
					reasoning:
						nextTurnSnapshot.thinkingLevel === undefined
							? config.reasoning
							: nextTurnSnapshot.thinkingLevel === "off"
								? undefined
								: nextTurnSnapshot.thinkingLevel,
				};
			}

			if (
				await config.shouldStopAfterTurn?.({
					message,
					toolResults,
					context: currentContext,
					newMessages,
				})
			) {
				await emit({ type: "agent_end", messages: newMessages });
				return;
			}

			pendingMessages = (await config.getSteeringMessages?.()) || [];
		}

		// Agent would stop here. Check for follow-up messages.
		const followUpMessages = (await config.getFollowUpMessages?.()) || [];
		if (followUpMessages.length > 0) {
			// Set as pending so inner loop processes them
			pendingMessages = followUpMessages;
			continue;
		}

		// No more messages, exit
		break;
	}

	await emit({ type: "agent_end", messages: newMessages });
}

/**
 * Stream an assistant response from the LLM.
 * This is where AgentMessage[] gets transformed to Message[] for the LLM.
 */
async function streamAssistantResponse(
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	streamFn?: StreamFn,
): Promise<AssistantMessage> {
	let partialMessage: AssistantMessage | null = null;
	let addedPartial = false;

	try {
		// Apply context transform if configured (AgentMessage[] → AgentMessage[])
		let messages = context.messages;
		if (config.transformContext) {
			messages = await config.transformContext(messages, signal);
		}

		// Convert to LLM-compatible messages (AgentMessage[] → Message[])
		const llmMessages = await config.convertToLlm(messages);

		// Build LLM context
		const llmContext: Context = {
			systemPrompt: context.systemPrompt,
			messages: llmMessages,
			tools: context.tools,
		};

		const streamFunction = streamFn || streamSimple;

		// Resolve API key (important for expiring tokens)
		const resolvedApiKey =
			(config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;

		const response = await streamFunction(config.model, llmContext, {
			...config,
			apiKey: resolvedApiKey,
			signal,
		});

		const iterator = response[Symbol.asyncIterator]();
		const eventReader = createAssistantEventReader(iterator, config.timeoutMs, signal);
		try {
			while (true) {
				const next = await eventReader.next();
				if (next.done) break;
				const event = next.value;
				switch (event.type) {
					case "start":
						partialMessage = event.partial;
						context.messages.push(partialMessage);
						addedPartial = true;
						await emit({ type: "message_start", message: { ...partialMessage } });
						break;

					case "text_start":
					case "text_delta":
					case "text_end":
					case "thinking_start":
					case "thinking_delta":
					case "thinking_end":
					case "toolcall_start":
					case "toolcall_delta":
					case "toolcall_end":
						if (partialMessage) {
							partialMessage = event.partial;
							context.messages[context.messages.length - 1] = partialMessage;
							await emit({
								type: "message_update",
								assistantMessageEvent: event,
								message: { ...partialMessage },
							});
						}
						break;

					case "done":
					case "error": {
						const finalMessage = normalizeTerminalAssistantMessage(await response.result(), event);
						if (addedPartial) {
							context.messages[context.messages.length - 1] = finalMessage;
						} else {
							context.messages.push(finalMessage);
						}
						if (!addedPartial) {
							await emit({ type: "message_start", message: { ...finalMessage } });
						}
						await emit({ type: "message_end", message: finalMessage });
						return finalMessage;
					}
				}
			}
		} finally {
			eventReader.dispose();
		}

		const finalMessage = await response.result();
		if (addedPartial) {
			context.messages[context.messages.length - 1] = finalMessage;
		} else {
			context.messages.push(finalMessage);
			await emit({ type: "message_start", message: { ...finalMessage } });
		}
		await emit({ type: "message_end", message: finalMessage });
		return finalMessage;
	} catch (error) {
		const finalMessage = createTerminalFailureAssistantMessage(
			config.model,
			signal?.aborted ? "aborted" : "error",
			error,
			partialMessage,
		);
		if (addedPartial) {
			context.messages[context.messages.length - 1] = finalMessage;
		} else {
			context.messages.push(finalMessage);
			await emit({ type: "message_start", message: { ...finalMessage } });
		}
		await emit({ type: "message_end", message: finalMessage });
		return finalMessage;
	}
}

const ABORTED = Symbol("aborted");

type AssistantEventReader = {
	next(): Promise<IteratorResult<AssistantMessageEvent>>;
	dispose(): void;
};

function createAssistantEventReader(
	iterator: AsyncIterator<AssistantMessageEvent>,
	timeoutMs: number | undefined,
	signal: AbortSignal | undefined,
): AssistantEventReader {
	const idleTimeoutMs =
		typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined;
	let removeAbortListener: (() => void) | undefined;
	let abortPromise: Promise<typeof ABORTED> | undefined;

	if (signal !== undefined) {
		if (signal.aborted) {
			abortPromise = Promise.resolve(ABORTED);
		} else {
			abortPromise = new Promise<typeof ABORTED>((resolve) => {
				const abortHandler = () => resolve(ABORTED);
				signal.addEventListener("abort", abortHandler, { once: true });
				removeAbortListener = () => signal.removeEventListener("abort", abortHandler);
			});
		}
	}

	return {
		next: () => {
			if (signal?.aborted) {
				void iterator.return?.();
				return Promise.reject(new Error("Request was aborted"));
			}
			return readNextAssistantEvent(iterator, idleTimeoutMs, abortPromise);
		},
		dispose: () => removeAbortListener?.(),
	};
}

async function readNextAssistantEvent(
	iterator: AsyncIterator<AssistantMessageEvent>,
	idleTimeoutMs: number | undefined,
	abortPromise: Promise<typeof ABORTED> | undefined,
): Promise<IteratorResult<AssistantMessageEvent>> {
	if (idleTimeoutMs === undefined && abortPromise === undefined) {
		return iterator.next();
	}

	let timeout: ReturnType<typeof setTimeout> | undefined;
	let settled = false;

	return new Promise<IteratorResult<AssistantMessageEvent>>((resolve, reject) => {
		const settle = (complete: () => void): void => {
			if (settled) return;
			settled = true;
			if (timeout !== undefined) {
				clearTimeout(timeout);
			}
			complete();
		};

		if (idleTimeoutMs !== undefined) {
			timeout = setTimeout(() => {
				void iterator.return?.();
				settle(() => reject(new StreamIdleTimeoutError(idleTimeoutMs)));
			}, idleTimeoutMs);
		}

		const next = abortPromise ? Promise.race([iterator.next(), abortPromise]) : iterator.next();
		void next.then(
			(result) => {
				if (result === ABORTED) {
					void iterator.return?.();
					settle(() => reject(new Error("Request was aborted")));
					return;
				}
				settle(() => resolve(result));
			},
			(error: unknown) => settle(() => reject(error)),
		);
	});
}

/**
 * Execute tool calls from an assistant message.
 */
async function executeToolCalls(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ExecutedToolCallBatch> {
	const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
	if (config.toolExecution === "sequential") {
		return executeToolCallsSequential(currentContext, assistantMessage, toolCalls, config, signal, emit);
	}
	return executeToolCallsParallel(currentContext, assistantMessage, toolCalls, config, signal, emit);
}

type ExecutedToolCallBatch = {
	messages: ToolResultMessage[];
	terminate: boolean;
};

type TerminalAssistantMessageEvent = Extract<AssistantMessageEvent, { type: "done" | "error" }>;

function createTerminalFailureAssistantMessage(
	model: AgentLoopConfig["model"],
	reason: Extract<AssistantMessage["stopReason"], "aborted" | "error">,
	error: unknown,
	partialMessage: AssistantMessage | null,
): AssistantMessage {
	const errorMessage = error instanceof Error ? error.message : String(error);
	return {
		role: "assistant",
		content: partialMessage?.content ?? [{ type: "text", text: "" }],
		api: partialMessage?.api ?? model.api,
		provider: partialMessage?.provider ?? model.provider,
		model: partialMessage?.model ?? model.id,
		responseModel: partialMessage?.responseModel,
		responseId: partialMessage?.responseId,
		diagnostics: partialMessage?.diagnostics,
		usage: partialMessage?.usage ?? EMPTY_USAGE,
		stopReason: reason,
		errorMessage: errorMessage || (reason === "aborted" ? "Request was aborted" : "Error"),
		timestamp: partialMessage?.timestamp ?? Date.now(),
	};
}

function normalizeTerminalAssistantMessage(
	message: AssistantMessage,
	event: TerminalAssistantMessageEvent,
): AssistantMessage {
	if (event.type === "done") {
		return message;
	}
	const errorMessage = message.errorMessage ?? (event.reason === "aborted" ? "Request was aborted" : "Error");
	if (message.stopReason === event.reason && message.errorMessage === errorMessage) {
		return message;
	}
	return {
		...message,
		stopReason: event.reason,
		errorMessage,
	};
}

async function executeToolCallsSequential(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCalls: AgentToolCall[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ExecutedToolCallBatch> {
	const finalizedCalls: FinalizedToolCallOutcome[] = [];
	const messages: ToolResultMessage[] = [];

	for (const toolCall of toolCalls) {
		await emit({
			type: "tool_execution_start",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			args: toolCall.arguments,
		});

		const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);
		let finalized: FinalizedToolCallOutcome;
		if (preparation.kind === "immediate") {
			finalized = {
				toolCall,
				result: preparation.result,
				isError: preparation.isError,
			};
		} else {
			const executed = await executePreparedToolCall(preparation, signal, emit);
			finalized = await finalizeExecutedToolCall(
				currentContext,
				assistantMessage,
				preparation,
				executed,
				config,
				signal,
			);
		}

		await emitToolExecutionEnd(finalized, emit);
		const toolResultMessage = createToolResultMessage(finalized);
		await emitToolResultMessage(toolResultMessage, emit);
		finalizedCalls.push(finalized);
		messages.push(toolResultMessage);

		if (signal?.aborted) {
			break;
		}
	}

	return {
		messages,
		terminate: shouldTerminateToolBatch(finalizedCalls),
	};
}

async function executeToolCallsParallel(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCalls: AgentToolCall[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ExecutedToolCallBatch> {
	const finalizedCalls: Promise<FinalizedToolCallOutcome>[] = [];
	let lastSequentialCall: Promise<FinalizedToolCallOutcome> | undefined;
	let currentParallelWave: Promise<FinalizedToolCallOutcome>[] = [];

	for (const toolCall of toolCalls) {
		await emit({
			type: "tool_execution_start",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			args: toolCall.arguments,
		});

		const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);
		const isSequential = isSequentialToolCall(currentContext, toolCall);
		const dependencies = isSequential
			? [...(lastSequentialCall ? [lastSequentialCall] : []), ...currentParallelWave]
			: lastSequentialCall
				? [lastSequentialCall]
				: [];

		const finalizedCall = (async () => {
			await Promise.all(dependencies);
			const finalized = await runPreparedToolCall(
				currentContext,
				assistantMessage,
				preparation,
				config,
				signal,
				emit,
			);
			await emitToolExecutionEnd(finalized, emit);
			return finalized;
		})();
		finalizedCalls.push(finalizedCall);

		if (isSequential) {
			lastSequentialCall = finalizedCall;
			currentParallelWave = [];
		} else {
			currentParallelWave.push(finalizedCall);
		}

		if (signal?.aborted) {
			break;
		}
	}

	const orderedFinalizedCalls = await Promise.all(finalizedCalls);
	const messages: ToolResultMessage[] = [];
	for (const finalized of orderedFinalizedCalls) {
		const toolResultMessage = createToolResultMessage(finalized);
		await emitToolResultMessage(toolResultMessage, emit);
		messages.push(toolResultMessage);
	}

	return {
		messages,
		terminate: shouldTerminateToolBatch(orderedFinalizedCalls),
	};
}

async function runPreparedToolCall(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	preparation: PreparedToolCall | ImmediateToolCallOutcome,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<FinalizedToolCallOutcome> {
	if (preparation.kind === "immediate") {
		return {
			toolCall: preparation.toolCall,
			result: preparation.result,
			isError: preparation.isError,
		};
	}

	const executed = await executePreparedToolCall(preparation, signal, emit);
	return finalizeExecutedToolCall(currentContext, assistantMessage, preparation, executed, config, signal);
}

function isSequentialToolCall(currentContext: AgentContext, toolCall: AgentToolCall): boolean {
	return currentContext.tools?.find((tool) => tool.name === toolCall.name)?.executionMode === "sequential";
}

type PreparedToolCall = {
	kind: "prepared";
	toolCall: AgentToolCall;
	tool: AgentTool<any>;
	args: unknown;
};

type ImmediateToolCallOutcome = {
	kind: "immediate";
	toolCall: AgentToolCall;
	result: AgentToolResult<any>;
	isError: boolean;
};

type ExecutedToolCallOutcome = {
	result: AgentToolResult<any>;
	isError: boolean;
};

type FinalizedToolCallOutcome = {
	toolCall: AgentToolCall;
	result: AgentToolResult<any>;
	isError: boolean;
};

function shouldTerminateToolBatch(finalizedCalls: FinalizedToolCallOutcome[]): boolean {
	return finalizedCalls.length > 0 && finalizedCalls.every((finalized) => finalized.result.terminate === true);
}

function prepareToolCallArguments(tool: AgentTool<any>, toolCall: AgentToolCall): AgentToolCall {
	if (!tool.prepareArguments) {
		return toolCall;
	}
	const preparedArguments = tool.prepareArguments(toolCall.arguments);
	if (preparedArguments === toolCall.arguments) {
		return toolCall;
	}
	return {
		...toolCall,
		arguments: preparedArguments as Record<string, any>,
	};
}

async function prepareToolCall(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCall: AgentToolCall,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
): Promise<PreparedToolCall | ImmediateToolCallOutcome> {
	const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
	if (!tool) {
		return {
			kind: "immediate",
			toolCall,
			result: createErrorToolResult(`Tool ${toolCall.name} not found`),
			isError: true,
		};
	}

	try {
		const preparedToolCall = prepareToolCallArguments(tool, toolCall);
		const validatedArgs = validateToolArguments(tool, preparedToolCall);
		if (config.beforeToolCall) {
			const beforeResult = await config.beforeToolCall(
				{
					assistantMessage,
					toolCall,
					args: validatedArgs,
					context: currentContext,
				},
				signal,
			);
			if (signal?.aborted) {
				return {
					kind: "immediate",
					toolCall,
					result: createErrorToolResult("Operation aborted"),
					isError: true,
				};
			}
			if (beforeResult?.block) {
				return {
					kind: "immediate",
					toolCall,
					result: createErrorToolResult(beforeResult.reason || "Tool execution was blocked"),
					isError: true,
				};
			}
		}
		if (signal?.aborted) {
			return {
				kind: "immediate",
				toolCall,
				result: createErrorToolResult("Operation aborted"),
				isError: true,
			};
		}
		return {
			kind: "prepared",
			toolCall,
			tool,
			args: validatedArgs,
		};
	} catch (error) {
		return {
			kind: "immediate",
			toolCall,
			result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
			isError: true,
		};
	}
}

async function executePreparedToolCall(
	prepared: PreparedToolCall,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ExecutedToolCallOutcome> {
	const updateEvents: Promise<void>[] = [];
	let acceptingUpdates = true;

	try {
		const result = await prepared.tool.execute(
			prepared.toolCall.id,
			prepared.args as never,
			signal,
			(partialResult) => {
				if (!acceptingUpdates) return;
				updateEvents.push(
					Promise.resolve(
						emit({
							type: "tool_execution_update",
							toolCallId: prepared.toolCall.id,
							toolName: prepared.toolCall.name,
							args: prepared.toolCall.arguments,
							partialResult,
						}),
					),
				);
			},
		);
		acceptingUpdates = false;
		await Promise.all(updateEvents);
		return { result, isError: false };
	} catch (error) {
		acceptingUpdates = false;
		await Promise.all(updateEvents);
		return {
			result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
			isError: true,
		};
	} finally {
		acceptingUpdates = false;
	}
}

async function finalizeExecutedToolCall(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	prepared: PreparedToolCall,
	executed: ExecutedToolCallOutcome,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
): Promise<FinalizedToolCallOutcome> {
	let result = executed.result;
	let isError = executed.isError;

	if (config.afterToolCall) {
		try {
			const afterResult = await config.afterToolCall(
				{
					assistantMessage,
					toolCall: prepared.toolCall,
					args: prepared.args,
					result,
					isError,
					context: currentContext,
				},
				signal,
			);
			if (afterResult) {
				result = {
					content: afterResult.content ?? result.content,
					details: afterResult.details ?? result.details,
					terminate: afterResult.terminate ?? result.terminate,
				};
				isError = afterResult.isError ?? isError;
			}
		} catch (error) {
			result = createErrorToolResult(error instanceof Error ? error.message : String(error));
			isError = true;
		}
	}

	return {
		toolCall: prepared.toolCall,
		result,
		isError,
	};
}

function createErrorToolResult(message: string): AgentToolResult<any> {
	return {
		content: [{ type: "text", text: message }],
		details: {},
	};
}

async function emitToolExecutionEnd(finalized: FinalizedToolCallOutcome, emit: AgentEventSink): Promise<void> {
	await emit({
		type: "tool_execution_end",
		toolCallId: finalized.toolCall.id,
		toolName: finalized.toolCall.name,
		result: finalized.result,
		isError: finalized.isError,
	});
}

function createToolResultMessage(finalized: FinalizedToolCallOutcome): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: finalized.toolCall.id,
		toolName: finalized.toolCall.name,
		content: finalized.result.content,
		details: finalized.result.details,
		isError: finalized.isError,
		timestamp: Date.now(),
	};
}

async function emitToolResultMessage(toolResultMessage: ToolResultMessage, emit: AgentEventSink): Promise<void> {
	await emit({ type: "message_start", message: toolResultMessage });
	await emit({ type: "message_end", message: toolResultMessage });
}
