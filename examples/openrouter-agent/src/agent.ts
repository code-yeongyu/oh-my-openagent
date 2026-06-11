import { EventEmitter } from "eventemitter3"
import { OpenRouterModelClient } from "./sdk-client"
import type { AgentConfig, AgentEvents, AgentStreamItem, Message, ModelClient } from "./types"
import type { Tool } from "@openrouter/agent"

type RuntimeConfig = {
  readonly model: string
  instructions: string
  readonly maxSteps: number
  readonly tools: Tool[]
}

export class Agent extends EventEmitter<AgentEvents> {
  private readonly client: ModelClient
  private readonly config: RuntimeConfig
  private readonly messages: Message[] = []

  constructor(config: AgentConfig) {
    super()
    this.client = config.client ?? new OpenRouterModelClient(config.apiKey)
    this.config = {
      model: config.model ?? "openrouter/auto",
      instructions: config.instructions ?? "You are a helpful assistant.",
      tools: [...(config.tools ?? [])],
      maxSteps: config.maxSteps ?? 5,
    }
  }

  getMessages(): readonly Message[] {
    return [...this.messages]
  }

  clearHistory(): void {
    this.messages.length = 0
  }

  setInstructions(instructions: string): void {
    this.config.instructions = instructions
  }

  addTool(newTool: Tool): void {
    this.config.tools.push(newTool)
  }

  async send(content: string): Promise<string> {
    const userMessage: Message = { role: "user", content }
    this.messages.push(userMessage)
    this.emit("message:user", userMessage)
    this.emit("thinking:start")

    try {
      const result = this.client.callModel({
        model: this.config.model,
        instructions: this.config.instructions,
        input: this.messages,
        tools: this.config.tools,
        maxSteps: this.config.maxSteps,
      })

      this.emit("stream:start")
      let fullText = ""

      for await (const item of result.getItemsStream()) {
        this.emit("item:update", item)
        fullText = this.handleStreamItem(item, fullText)
      }

      if (fullText.length === 0) {
        fullText = await result.getText()
      }

      this.emit("stream:end", fullText)
      const assistantMessage: Message = { role: "assistant", content: fullText }
      this.messages.push(assistantMessage)
      this.emit("message:assistant", assistantMessage)
      return fullText
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      this.emit("error", normalized)
      throw normalized
    } finally {
      this.emit("thinking:end")
    }
  }

  async sendSync(content: string): Promise<string> {
    const userMessage: Message = { role: "user", content }
    this.messages.push(userMessage)
    this.emit("message:user", userMessage)

    try {
      const result = this.client.callModel({
        model: this.config.model,
        instructions: this.config.instructions,
        input: this.messages,
        tools: this.config.tools,
        maxSteps: this.config.maxSteps,
      })
      const fullText = await result.getText()
      const assistantMessage: Message = { role: "assistant", content: fullText }
      this.messages.push(assistantMessage)
      this.emit("message:assistant", assistantMessage)
      return fullText
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      this.emit("error", normalized)
      throw normalized
    }
  }

  private handleStreamItem(item: AgentStreamItem, fullText: string): string {
    switch (item.type) {
      case "message": {
        const text = item.content.find((entry) => entry.type === "output_text")?.text ?? ""
        const delta = text.slice(fullText.length)
        if (delta.length > 0) {
          this.emit("stream:delta", delta, text)
        }
        return text
      }
      case "function_call":
        if (item.status === "completed") {
          this.emit("tool:call", item.name, parseToolArguments(item.arguments))
        }
        return fullText
      case "function_call_output":
        this.emit("tool:result", item.callId, item.output)
        return fullText
      case "reasoning": {
        const text = item.content.find((entry) => entry.type === "output_text")?.text ?? ""
        if (text.length > 0) {
          this.emit("reasoning:update", text)
        }
        return fullText
      }
      case "other":
        return fullText
      default:
        return assertNever(item)
    }
  }
}

export function createAgent(config: AgentConfig): Agent {
  return new Agent(config)
}

function parseToolArguments(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch (error) {
    if (error instanceof SyntaxError) {
      return raw
    }
    throw error
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled stream item: ${String(value)}`)
}
