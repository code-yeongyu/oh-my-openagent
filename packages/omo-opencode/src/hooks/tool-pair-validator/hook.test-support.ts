import type { MessagesTransformHook } from "./types"

export type TestPart = {
  type: string
  [key: string]: unknown
}

export type TestMessage = {
  info: { role: "assistant" | "user"; id?: string; sessionID?: string }
  parts: TestPart[]
}

type ToolPartOptions = {
  callID: string
  status: "pending" | "running" | "completed" | "error"
  tool?: string
  input?: Record<string, unknown>
  output?: string
  error?: string
  start?: number
}

/**
 * Mirrors the real OpenCode `ToolPart` shape (`@opencode-ai/sdk`): one part carries
 * the call id AND the state that later becomes the provider's `tool_result`.
 */
export function createToolPart(options: ToolPartOptions): TestPart {
  const start = options.start ?? 1_700_000_000_000
  const base = {
    id: `prt_${options.callID}`,
    sessionID: "ses_test",
    messageID: "msg_test",
    type: "tool",
    callID: options.callID,
    tool: options.tool ?? "bash",
  }

  if (options.status === "pending") {
    return { ...base, state: { status: "pending", input: options.input ?? {}, raw: "" } }
  }

  if (options.status === "running") {
    return { ...base, state: { status: "running", input: options.input ?? {}, time: { start } } }
  }

  if (options.status === "completed") {
    return {
      ...base,
      state: {
        status: "completed",
        input: options.input ?? {},
        output: options.output ?? "",
        title: options.tool ?? "bash",
        metadata: {},
        time: { start, end: start + 10 },
      },
    }
  }

  return {
    ...base,
    state: {
      status: "error",
      input: options.input ?? {},
      error: options.error ?? "failed",
      time: { start, end: start + 10 },
    },
  }
}

export async function runToolPairValidator(hook: MessagesTransformHook, messages: TestMessage[]): Promise<void> {
  const transform = hook["experimental.chat.messages.transform"]
  if (!transform) {
    throw new Error("missing tool pair validator transform")
  }

  await transform({}, { messages: messages as never })
}
