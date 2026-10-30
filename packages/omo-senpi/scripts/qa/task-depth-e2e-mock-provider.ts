#!/usr/bin/env node
// Lane-private mock provider for task-depth-e2e.mjs (#9036): a model that ALWAYS delegates. Every
// turn that has not yet seen a tool result calls `task` again, so the only thing that can stop the
// tree is the engine's max_depth. Each request is appended to <cwd>/depth-requests.jsonl with the
// serving process's pid and task-depth env, which is how the driver bounds requests and depth.
import { createLocalAssistantMessageEventStream, stepToAssistantMessage, type MockStep } from "./mock-provider/index.ts"

declare const process: {
  pid: number
  argv: string[]
  cwd(): string
  getBuiltinModule<T>(id: string): T
}

interface FsModule {
  appendFileSync(path: string, data: string): void
}

interface PathModule {
  join(...paths: string[]): string
}

const { appendFileSync } = process.getBuiltinModule<FsModule>("fs")
const { join } = process.getBuiltinModule<PathModule>("path")
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}

type Api = "openai-completions"

interface Message {
  readonly role?: string
  readonly content?: unknown
}

interface Context {
  readonly cwd?: string
  readonly messages?: readonly Message[]
  readonly tools?: ReadonlyArray<{ readonly name?: string }>
}

interface ExtensionAPI {
  registerProvider(id: string, provider: Record<string, unknown>): void
}

let requestCount = 0

export default function registerDepthMockProvider(pi: ExtensionAPI): void {
  pi.registerProvider("omo-mock", {
    name: "omo depth mock provider",
    baseUrl: "file://mock-provider",
    apiKey: "mock",
    api: "openai-completions" satisfies Api,
    models: [{
      id: "mock-1",
      name: "Mock 1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 4096,
    }],
    streamSimple(_model: unknown, context: Context, options?: { signal?: AbortSignal }) {
      requestCount += 1
      const toolResult = lastToolResultText(context)
      const hasTaskTool = (context.tools ?? []).some((tool) => tool.name === "task")
      const delegate = toolResult === undefined && hasTaskTool
      appendFileSync(join(context.cwd ?? process.cwd(), "depth-requests.jsonl"), `${JSON.stringify({
        pid: process.pid,
        rpc: process.argv.includes("rpc"),
        depth_env: env["OMO_SENPI_TASK_DEPTH"] ?? null,
        root_env: env["OMO_SENPI_TASK_ROOT_SESSION_ID"] ?? null,
        has_task_tool: hasTaskTool,
        action: delegate ? "delegate" : "answer",
        tool_result: toolResult?.slice(0, 400) ?? null,
        at: Date.now(),
      })}\n`)
      if (delegate) {
        return streamStep({
          type: "tool_call",
          name: "task",
          arguments: {
            subagent_type: "worker",
            model: "omo-mock/mock-1",
            prompt: "Delegate this to another worker subagent; never do it yourself.",
            run_in_background: false,
            load_skills: [],
          },
        }, requestCount, options)
      }
      return streamStep({ type: "text", text: `depth mock answered: ${toolResult ?? "no task tool"}` }, requestCount, options)
    },
  })
}

function lastToolResultText(context: Context): string | undefined {
  const messages = context.messages ?? []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== "toolResult") continue
    return textOf(message.content)
  }
  return undefined
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.map((part: unknown) =>
    typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? part.text : "").join("")
}

// Streams one step with every partial carrying the content block it announces. senpi's RPC event
// serializer rejects a toolcall_start whose partial has no tool call at its index, which stalls a
// process child's turn; the shared streamMockStep only ever ran in print-mode parents.
function streamStep(step: MockStep, callCount: number, options?: { signal?: AbortSignal }) {
  const stream = createLocalAssistantMessageEventStream()
  const message = stepToAssistantMessage(step, callCount)
  queueMicrotask(() => {
    if (options?.signal?.aborted) {
      const aborted = { ...message, stopReason: "aborted" as const }
      stream.push({ type: "error", reason: "aborted", error: aborted })
      stream.end(aborted)
      return
    }
    stream.push({ type: "start", partial: { ...message, content: [] } })
    const block = message.content[0]
    if (block?.type === "toolCall") {
      stream.push({ type: "toolcall_start", contentIndex: 0, partial: message })
      stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(block.arguments), partial: message })
      stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: block, partial: message })
    } else if (block?.type === "text") {
      stream.push({ type: "text_start", contentIndex: 0, partial: message })
      stream.push({ type: "text_delta", contentIndex: 0, delta: block.text, partial: message })
      stream.push({ type: "text_end", contentIndex: 0, content: block.text, partial: message })
    }
    stream.push({ type: "done", reason: message.stopReason, message })
    stream.end(message)
  })
  return stream
}
