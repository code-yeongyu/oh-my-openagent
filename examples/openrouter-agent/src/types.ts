import type { Tool } from "@openrouter/agent"

export type MessageRole = "user" | "assistant" | "system"

export type Message = {
  readonly role: MessageRole
  readonly content: string
}

export type OutputTextContent = {
  readonly type: "output_text"
  readonly text: string
}

export type AgentStreamItem =
  | {
      readonly type: "message"
      readonly id: string
      readonly status?: string
      readonly content: readonly OutputTextContent[]
    }
  | {
      readonly type: "function_call"
      readonly id: string
      readonly status?: string
      readonly name: string
      readonly arguments: string
    }
  | {
      readonly type: "function_call_output"
      readonly id: string
      readonly callId: string
      readonly output: unknown
    }
  | {
      readonly type: "reasoning"
      readonly id: string
      readonly content: readonly OutputTextContent[]
    }
  | {
      readonly type: "other"
      readonly id: string
      readonly originalType: string
    }

export type ModelRequest = {
  readonly model: string
  readonly instructions: string
  readonly input: readonly Message[]
  readonly tools: readonly Tool[]
  readonly maxSteps: number
}

export type ModelResponse = {
  readonly getItemsStream: () => AsyncIterable<AgentStreamItem>
  readonly getText: () => Promise<string>
}

export interface ModelClient {
  callModel(request: ModelRequest): ModelResponse
}

export type AgentConfig = {
  readonly apiKey: string
  readonly model?: string
  readonly instructions?: string
  readonly tools?: readonly Tool[]
  readonly maxSteps?: number
  readonly client?: ModelClient
}

export type AgentEvents = {
  readonly "message:user": (message: Message) => void
  readonly "message:assistant": (message: Message) => void
  readonly "item:update": (item: AgentStreamItem) => void
  readonly "stream:start": () => void
  readonly "stream:delta": (delta: string, accumulated: string) => void
  readonly "stream:end": (fullText: string) => void
  readonly "tool:call": (name: string, args: unknown) => void
  readonly "tool:result": (callId: string, result: unknown) => void
  readonly "reasoning:update": (text: string) => void
  readonly error: (error: Error) => void
  readonly "thinking:start": () => void
  readonly "thinking:end": () => void
}
