import { OpenRouter, callModel, stepCountIs } from "@openrouter/agent"
import type { StreamableOutputItem } from "@openrouter/agent"
import type { ModelClient, ModelRequest, ModelResponse, OutputTextContent } from "./types"
import type { AgentStreamItem } from "./types"

export class OpenRouterModelClient implements ModelClient {
  private readonly client: OpenRouter

  constructor(apiKey: string) {
    this.client = new OpenRouter({ apiKey })
  }

  callModel(request: ModelRequest): ModelResponse {
    const result = callModel(this.client, {
      model: request.model,
      instructions: request.instructions,
      input: formatTranscript(request.input),
      tools: request.tools,
      stopWhen: stepCountIs(request.maxSteps),
      allowFinalResponse: true,
    })

    return {
      getItemsStream: async function* (): AsyncIterable<AgentStreamItem> {
        for await (const item of result.getItemsStream()) {
          yield normalizeStreamItem(item)
        }
      },
      getText: () => result.getText(),
    }
  }
}

function normalizeStreamItem(item: StreamableOutputItem): AgentStreamItem {
  switch (item.type) {
    case "message":
      return {
        type: "message",
        id: item.id,
        content: item.content.flatMap(readOutputTextContent),
        ...(item.status === undefined ? {} : { status: item.status }),
      }
    case "function_call":
      return {
        type: "function_call",
        id: item.id ?? item.callId,
        name: item.name,
        arguments: item.arguments,
        ...(item.status === undefined ? {} : { status: item.status }),
      }
    case "function_call_output":
      return {
        type: "function_call_output",
        id: item.callId,
        callId: item.callId,
        output: item.output,
      }
    case "reasoning":
      return {
        type: "reasoning",
        id: item.id,
        content: item.content?.flatMap(readReasoningTextContent) ?? [],
      }
    default:
      return {
        type: "other",
        id: readItemId(item),
        originalType: item.type,
      }
  }
}

function formatTranscript(messages: readonly ModelRequest["input"][number][]): string {
  return messages.map((message) => `${message.role}: ${message.content}`).join("\n")
}

function readOutputTextContent(content: { readonly type: string }): readonly OutputTextContent[] {
  if (content.type === "output_text" && "text" in content && typeof content.text === "string") {
    return [{ type: "output_text", text: content.text }]
  }
  return []
}

function readReasoningTextContent(content: { readonly type: string }): readonly OutputTextContent[] {
  if (content.type === "reasoning_text" && "text" in content && typeof content.text === "string") {
    return [{ type: "output_text", text: content.text }]
  }
  return []
}

function readItemId(item: { readonly type: string }): string {
  if ("id" in item && typeof item.id === "string") {
    return item.id
  }
  return item.type
}
