import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { matchGate } from "./gate-rule"

const QUESTION_TOOLS: ReadonlySet<string> = new Set(["ask_user_question", "request_user_input"])

interface ToolCallEvent {
  readonly toolName: string
  readonly input: Record<string, unknown>
}

function asToolCallEvent(payload: unknown): ToolCallEvent | undefined {
  if (typeof payload !== "object" || payload === null) return undefined
  const toolName = Reflect.get(payload, "toolName")
  const input = Reflect.get(payload, "input")
  if (typeof toolName !== "string") return undefined
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined
  return { toolName, input: input as Record<string, unknown> }
}

export function createQuestionGatesComponent(): OmoSenpiComponent {
  return {
    name: "question-gates",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      pi.on("tool_call", (payload: unknown): undefined => {
        const event = asToolCallEvent(payload)
        if (event === undefined || !QUESTION_TOOLS.has(event.toolName)) return undefined
        if (event.input["required"] === true) return undefined
        const gate = matchGate(event.input)
        if (gate === undefined) return undefined
        event.input["required"] = true
        ctx.logger.debug?.("omo-senpi question-gates forced required", {
          tool: event.toolName,
          header: gate.header,
          rule: gate.rule,
        })
        return undefined
      })
    },
  }
}
