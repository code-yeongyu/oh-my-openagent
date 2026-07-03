import type {
	AssistantMessage,
	AssistantMessageEventStream,
	ThinkingContent,
	Tool,
	ToolCall,
	Usage,
} from "../types.ts";
import { AssistantMessageEventStream as AssistantMessageEventStreamImpl } from "../utils/event-stream.ts";
import { parseStreamingJson } from "../utils/json-parse.ts";
import type { StreamParserEvent, ToolCallProtocol } from "./types.ts";

type PartialToolCall = ToolCall & {
	partialJson: string;
};

function isPartialToolCall(block: AssistantMessage["content"][number] | undefined): block is PartialToolCall {
	return block?.type === "toolCall" && typeof (block as PartialToolCall).partialJson === "string";
}

function cloneUsage(usage: Usage): Usage {
	return {
		input: usage.input,
		output: usage.output,
		cacheRead: usage.cacheRead,
		cacheWrite: usage.cacheWrite,
		totalTokens: usage.totalTokens,
		cost: {
			input: usage.cost.input,
			output: usage.cost.output,
			cacheRead: usage.cost.cacheRead,
			cacheWrite: usage.cost.cacheWrite,
			total: usage.cost.total,
		},
	};
}

function createOuterMessage(message: AssistantMessage): AssistantMessage {
	return {
		role: "assistant",
		api: message.api,
		provider: message.provider,
		model: message.model,
		responseId: message.responseId,
		content: [],
		usage: cloneUsage(message.usage),
		stopReason: message.stopReason,
		errorMessage: message.errorMessage,
		timestamp: message.timestamp,
	};
}

function syncOuterMetadata(target: AssistantMessage, source: AssistantMessage): void {
	target.api = source.api;
	target.provider = source.provider;
	target.model = source.model;
	target.responseId = source.responseId;
	target.usage = cloneUsage(source.usage);
	target.stopReason = source.stopReason;
	target.errorMessage = source.errorMessage;
	target.timestamp = source.timestamp;
}

function pushParserEvent(
	parserEvent: StreamParserEvent,
	outerStream: AssistantMessageEventStream,
	outerMessage: AssistantMessage,
	textBlockIndexByInnerIndex: Map<number, number | null>,
	toolCallIndexByParserIndex: Map<number, number>,
	currentInnerTextIndex: number | null,
): void {
	switch (parserEvent.type) {
		case "text": {
			if (currentInnerTextIndex == null) {
				return;
			}

			let textBlockIndex = textBlockIndexByInnerIndex.get(currentInnerTextIndex) ?? null;
			if (textBlockIndex == null) {
				textBlockIndex = outerMessage.content.length;
				outerMessage.content.push({ type: "text", text: parserEvent.text });
				textBlockIndexByInnerIndex.set(currentInnerTextIndex, textBlockIndex);
			} else {
				const block = outerMessage.content[textBlockIndex];
				if (block?.type !== "text") {
					return;
				}
				block.text += parserEvent.text;
			}

			outerStream.push({
				type: "text_delta",
				contentIndex: textBlockIndex,
				delta: parserEvent.text,
				partial: outerMessage,
			});
			return;
		}
		case "toolcall_start": {
			const contentIndex = outerMessage.content.length;
			const toolCall: PartialToolCall = {
				type: "toolCall",
				id: parserEvent.id,
				name: parserEvent.name,
				arguments: {},
				partialJson: "",
			};
			outerMessage.content.push(toolCall);
			toolCallIndexByParserIndex.set(parserEvent.index, contentIndex);
			if (currentInnerTextIndex != null) {
				textBlockIndexByInnerIndex.set(currentInnerTextIndex, null);
			}
			outerStream.push({
				type: "toolcall_start",
				contentIndex,
				partial: outerMessage,
			});
			return;
		}
		case "toolcall_delta": {
			const contentIndex = toolCallIndexByParserIndex.get(parserEvent.index);
			if (contentIndex == null) {
				return;
			}

			const block = outerMessage.content[contentIndex];
			if (!isPartialToolCall(block)) {
				return;
			}

			block.partialJson += parserEvent.argumentsDelta;
			block.arguments = parseStreamingJson<Record<string, unknown>>(block.partialJson);
			outerStream.push({
				type: "toolcall_delta",
				contentIndex,
				delta: parserEvent.argumentsDelta,
				partial: outerMessage,
			});
			return;
		}
		case "toolcall_end": {
			const contentIndex = toolCallIndexByParserIndex.get(parserEvent.index);
			if (contentIndex == null) {
				return;
			}

			const block = outerMessage.content[contentIndex];
			if (block?.type !== "toolCall") {
				return;
			}

			const finalToolCall: ToolCall = {
				type: "toolCall",
				id: parserEvent.id,
				name: parserEvent.name,
				arguments: parserEvent.arguments,
			};
			outerMessage.content[contentIndex] = finalToolCall;
			outerStream.push({
				type: "toolcall_end",
				contentIndex,
				toolCall: finalToolCall,
				partial: outerMessage,
			});
		}
	}
}

function processParserEvents(
	parserEvents: StreamParserEvent[],
	outerStream: AssistantMessageEventStream,
	outerMessage: AssistantMessage,
	textBlockIndexByInnerIndex: Map<number, number | null>,
	toolCallIndexByParserIndex: Map<number, number>,
	currentInnerTextIndex: number | null,
): boolean {
	let emittedToolCall = false;
	for (const parserEvent of parserEvents) {
		if (
			parserEvent.type === "toolcall_start" ||
			parserEvent.type === "toolcall_delta" ||
			parserEvent.type === "toolcall_end"
		) {
			emittedToolCall = true;
		}

		pushParserEvent(
			parserEvent,
			outerStream,
			outerMessage,
			textBlockIndexByInnerIndex,
			toolCallIndexByParserIndex,
			currentInnerTextIndex,
		);
	}
	return emittedToolCall;
}

function finalizeMessage(
	outerMessage: AssistantMessage,
	doneMessage: AssistantMessage,
	sawToolCall: boolean,
): AssistantMessage {
	const finalMessage: AssistantMessage = {
		...createOuterMessage(doneMessage),
		content: outerMessage.content,
	};

	if (sawToolCall && finalMessage.stopReason === "stop") {
		finalMessage.stopReason = "toolUse";
	}

	return finalMessage;
}

function hasCompletedToolCallContent(message: AssistantMessage): boolean {
	return message.content.some((block) => block.type === "toolCall");
}

function finalizePendingTextBlock(
	outerStream: AssistantMessageEventStream,
	outerMessage: AssistantMessage,
	parser: ReturnType<ToolCallProtocol["createStreamParser"]>,
	textBlockIndexByInnerIndex: Map<number, number | null>,
	toolCallIndexByParserIndex: Map<number, number>,
	currentInnerTextIndex: number | null,
	sawToolCall: boolean,
): { currentInnerTextIndex: null; sawToolCall: boolean } {
	const nextSawToolCall =
		processParserEvents(
			parser.finish(),
			outerStream,
			outerMessage,
			textBlockIndexByInnerIndex,
			toolCallIndexByParserIndex,
			currentInnerTextIndex,
		) || sawToolCall;

	const outerContentIndex =
		currentInnerTextIndex == null ? null : (textBlockIndexByInnerIndex.get(currentInnerTextIndex) ?? null);
	if (outerContentIndex != null) {
		const outerBlock = outerMessage.content[outerContentIndex];
		if (outerBlock?.type === "text") {
			outerStream.push({
				type: "text_end",
				contentIndex: outerContentIndex,
				content: outerBlock.text,
				partial: outerMessage,
			});
		}
	}

	return {
		currentInnerTextIndex: null,
		sawToolCall: nextSawToolCall,
	};
}

export function wrapStreamWithToolCallMiddleware(
	innerStream: AssistantMessageEventStream,
	protocol: ToolCallProtocol,
	tools: Tool[],
): AssistantMessageEventStream {
	const outerStream = new AssistantMessageEventStreamImpl();
	const parser = protocol.createStreamParser(tools);

	void (async (): Promise<void> => {
		let outerMessage: AssistantMessage | null = null;
		let currentInnerTextIndex: number | null = null;
		let sawToolCall = false;
		const textBlockIndexByInnerIndex = new Map<number, number | null>();
		const thinkingBlockIndexByInnerIndex = new Map<number, number>();
		const toolCallIndexByParserIndex = new Map<number, number>();

		try {
			for await (const event of innerStream) {
				switch (event.type) {
					case "start": {
						outerMessage = createOuterMessage(event.partial);
						outerStream.push({ type: "start", partial: outerMessage });
						break;
					}
					case "text_start": {
						if (outerMessage) {
							syncOuterMetadata(outerMessage, event.partial);
						}
						currentInnerTextIndex = event.contentIndex;
						textBlockIndexByInnerIndex.set(event.contentIndex, null);
						if (outerMessage) {
							outerStream.push({ ...event, partial: outerMessage });
						}
						break;
					}
					case "text_delta": {
						if (!outerMessage) {
							break;
						}
						syncOuterMetadata(outerMessage, event.partial);
						sawToolCall =
							processParserEvents(
								parser.feed(event.delta),
								outerStream,
								outerMessage,
								textBlockIndexByInnerIndex,
								toolCallIndexByParserIndex,
								currentInnerTextIndex,
							) || sawToolCall;
						break;
					}
					case "text_end": {
						if (!outerMessage) {
							break;
						}
						syncOuterMetadata(outerMessage, event.partial);
						({ currentInnerTextIndex, sawToolCall } = finalizePendingTextBlock(
							outerStream,
							outerMessage,
							parser,
							textBlockIndexByInnerIndex,
							toolCallIndexByParserIndex,
							currentInnerTextIndex,
							sawToolCall,
						));
						break;
					}
					case "thinking_start": {
						if (!outerMessage) {
							break;
						}
						syncOuterMetadata(outerMessage, event.partial);
						const contentIndex = outerMessage.content.length;
						const thinkingBlock: ThinkingContent = { type: "thinking", thinking: "" };
						outerMessage.content.push(thinkingBlock);
						thinkingBlockIndexByInnerIndex.set(event.contentIndex, contentIndex);
						outerStream.push({ type: "thinking_start", contentIndex, partial: outerMessage });
						break;
					}
					case "thinking_delta": {
						if (!outerMessage) {
							break;
						}
						syncOuterMetadata(outerMessage, event.partial);
						const contentIndex = thinkingBlockIndexByInnerIndex.get(event.contentIndex);
						if (contentIndex == null) {
							break;
						}
						const block = outerMessage.content[contentIndex];
						if (block?.type !== "thinking") {
							break;
						}
						block.thinking += event.delta;
						outerStream.push({
							type: "thinking_delta",
							contentIndex,
							delta: event.delta,
							partial: outerMessage,
						});
						break;
					}
					case "thinking_end": {
						if (!outerMessage) {
							break;
						}
						syncOuterMetadata(outerMessage, event.partial);
						const contentIndex = thinkingBlockIndexByInnerIndex.get(event.contentIndex);
						if (contentIndex == null) {
							break;
						}
						const block = outerMessage.content[contentIndex];
						if (block?.type !== "thinking") {
							break;
						}
						block.thinking = event.content;
						outerStream.push({
							type: "thinking_end",
							contentIndex,
							content: event.content,
							partial: outerMessage,
						});
						break;
					}
					case "done": {
						if (!outerMessage) {
							outerMessage = createOuterMessage(event.message);
						}
						const finalMessage = finalizeMessage(outerMessage, event.message, sawToolCall);
						const finalReason = sawToolCall && event.reason === "stop" ? "toolUse" : event.reason;
						outerStream.push({ type: "done", reason: finalReason, message: finalMessage });
						outerStream.end();
						return;
					}
					case "error": {
						if (!outerMessage) {
							outerStream.push(event);
							outerStream.end(event.error);
							return;
						}

						syncOuterMetadata(outerMessage, event.error);
						if (currentInnerTextIndex != null) {
							({ currentInnerTextIndex, sawToolCall } = finalizePendingTextBlock(
								outerStream,
								outerMessage,
								parser,
								textBlockIndexByInnerIndex,
								toolCallIndexByParserIndex,
								currentInnerTextIndex,
								sawToolCall,
							));
						}

						const finalErrorMessage = finalizeMessage(outerMessage, event.error, sawToolCall);
						if (sawToolCall && hasCompletedToolCallContent(finalErrorMessage)) {
							const recoveredMessage: AssistantMessage = {
								...finalErrorMessage,
								stopReason: "toolUse",
							};
							outerStream.push({ type: "done", reason: "toolUse", message: recoveredMessage });
							outerStream.end(recoveredMessage);
							return;
						}
						outerStream.push({ type: "error", reason: event.reason, error: finalErrorMessage });
						outerStream.end(finalErrorMessage);
						return;
					}
				}
			}

			const finalInnerMessage = await innerStream.result();
			if (!outerMessage) {
				outerMessage = createOuterMessage(finalInnerMessage);
			}
			outerStream.end(finalizeMessage(outerMessage, finalInnerMessage, sawToolCall));
		} catch (error) {
			const fallbackMessage = outerMessage ?? createOuterMessage(await innerStream.result());
			fallbackMessage.stopReason = "error";
			fallbackMessage.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			outerStream.push({ type: "error", reason: "error", error: fallbackMessage });
			outerStream.end();
		}
	})();

	return outerStream;
}
