import { randomBytes, randomUUID } from "node:crypto"
import type { ChatCompletionResponse, ToolCallResponse } from "./schemas"

type AssistantMessage = ChatCompletionResponse["choices"][number]["message"] & {
  reasoning_content?: string
}

function buildMessage(args: {
  content: string | null
  reasoning_content?: string
  tool_calls?: ToolCallResponse[]
}): AssistantMessage {
  const message: AssistantMessage = { role: "assistant", content: args.content }
  if (typeof args.reasoning_content === "string" && args.reasoning_content.length > 0) {
    message.reasoning_content = args.reasoning_content
  }
  if (args.tool_calls) message.tool_calls = args.tool_calls
  return message
}

export function buildOpenAIResponse(args: {
  content: string
  model: string
  reasoning_content?: string
}): ChatCompletionResponse {
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: args.model,
    choices: [
      {
        index: 0,
        message: buildMessage({
          content: args.content,
          reasoning_content: args.reasoning_content,
        }),
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }
}

export type ToolCallSpec = {
  name: string
  arguments: Record<string, unknown>
}

export function buildOpenAIResponseWithToolCalls(args: {
  toolCalls: ReadonlyArray<ToolCallSpec>
  model: string
  content?: string | null
  reasoning_content?: string
}): ChatCompletionResponse {
  if (args.toolCalls.length === 0) {
    throw new Error("buildOpenAIResponseWithToolCalls requires at least one tool call")
  }
  const tool_calls: ToolCallResponse[] = args.toolCalls.map((c) => ({
    id: `call_${randomBytes(8).toString("hex")}`,
    type: "function",
    function: { name: c.name, arguments: JSON.stringify(c.arguments) },
  }))
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: args.model,
    choices: [
      {
        index: 0,
        message: buildMessage({
          content: args.content ?? null,
          reasoning_content: args.reasoning_content,
          tool_calls,
        }),
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }
}
