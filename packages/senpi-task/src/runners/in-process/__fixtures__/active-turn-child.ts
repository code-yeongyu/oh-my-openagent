import type { ToolDefinition } from "@code-yeongyu/senpi"

import { assistant, streamMessage } from "../../__fixtures__/in-process-fallback-session"
import type { ChildSpec, InProcessRunnerOptions } from "../../in-process"
import type { BuiltinChildMachine } from "./builtin-child"

// omo#15191. A real in-process child whose first turn stays ACTIVE until something stops it: either the
// provider's reply stays open, or the reply asks for a tool that keeps running. Only the provider is faked.

export type ActiveTurn = "holds" | "runs-a-tool"

const PROVIDER = "active-turn-test"
const MODEL = "child-stays-active"
const WAIT_TOOL = "wait_for_stop"

type ActiveTurnChild = {
  readonly spec: ChildSpec
  readonly runnerOptions: InProcessRunnerOptions
  /** Resolves once the turn is in its active state: the reply is open, or the tool has started. */
  readonly whenActive: Promise<void>
  observed(): { readonly providerCalls: number; readonly providerAborted: boolean; readonly tool: string }
}

export function createActiveTurnChild(machine: BuiltinChildMachine, taskId: string, turn: ActiveTurn): ActiveTurnChild {
  const active = Promise.withResolvers<void>()
  const seen = { providerCalls: 0, providerAborted: false, tool: "never started" }
  const provider = {
    api: "openai-completions",
    baseUrl: "file://active-turn-test",
    apiKey: "test-key",
    models: [
      {
        id: MODEL,
        name: MODEL,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 4096,
      },
    ],
    streamSimple(_model: unknown, _context: unknown, options?: { readonly signal?: AbortSignal }) {
      seen.providerCalls += 1
      if (turn === "runs-a-tool") {
        if (seen.providerCalls > 1) return streamMessage(assistant(MODEL, "stop", "done", undefined, PROVIDER))
        return streamMessage({
          ...assistant(MODEL, "toolUse", "", undefined, PROVIDER),
          content: [{ type: "toolCall", id: "call-wait", name: WAIT_TOOL, arguments: {} }],
        })
      }
      active.resolve()
      return openUntilAborted(options?.signal, () => {
        seen.providerAborted = true
      })
    },
  }
  Reflect.apply(machine.modelRegistry.registerProvider, machine.modelRegistry, [PROVIDER, provider])
  const model = machine.modelRegistry.find(PROVIDER, MODEL)
  if (model === undefined) throw new Error(`${MODEL} missing from the fake provider`)
  const waitTool: ToolDefinition = {
    name: WAIT_TOOL,
    label: "wait for stop",
    description: "Runs until its signal aborts.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: async (_toolCallId, _params, signal) => {
      seen.tool = "running"
      active.resolve()
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }))
      seen.tool = "stopped by its signal"
      return { content: [{ type: "text", text: "stopped" }], details: {} }
    },
  }
  return {
    spec: {
      ...machine.spec(taskId, "succeeds"),
      model,
      selectedModel: `${PROVIDER}/${MODEL}`,
      ...(turn === "runs-a-tool" ? { ownApprovalMode: { allowTools: [WAIT_TOOL] } } : {}),
    },
    runnerOptions: turn === "runs-a-tool" ? { sharedParentTools: [waitTool] } : {},
    whenActive: active.promise,
    observed: () => ({ ...seen }),
  }
}

// A provider reply that stays open; it ends as aborted when the engine aborts the request.
function openUntilAborted(signal: AbortSignal | undefined, onAbort: () => void) {
  const message = assistant(MODEL, "aborted", "", "Request was aborted", PROVIDER)
  const ended = Promise.withResolvers<void>()
  const end = (): void => {
    onAbort()
    ended.resolve()
  }
  if (signal?.aborted === true) end()
  else signal?.addEventListener("abort", end, { once: true })
  let delivered = false
  return {
    push() {},
    end() {},
    result: () => ended.promise.then(() => message),
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<unknown>> {
          await ended.promise
          if (delivered) return { value: undefined, done: true }
          delivered = true
          return { value: { type: "error", reason: "aborted", error: message }, done: false }
        },
      }
    },
  }
}
