// Surface (b) of the X1a proof: the thread tools inside an agent session on device A. The session's model is scripted
// (the thread-tools QA kit's fake model): each scenario call becomes one prompt carrying `QA:CALL <tool> <base64 args>`,
// the model makes exactly that tool call, and the tool's result as the session handed it back to the model is the raw
// answer. The run supplies the session; this driver only names the tool and its arguments.
import type { Mapping, Op } from "../scenario.ts"
import { type Answer, type Call, call, type Driver, isRecord, succeeded, threadOf } from "./driver.ts"

export const MAPPING: Readonly<Record<Op, Mapping>> = {
  create: call("thread_create { device, prompt }"),
  send: call("thread_send { thread, message, delivery }"),
  read: call("thread_read { thread }"),
  interrupt: call("thread_interrupt { thread }"),
  setModel: call("thread_set_model { thread, model }"),
  setReasoning: call("thread_set_reasoning { thread, level }"),
  close: call("thread_close { thread }"),
}

const toolCall = (
  op: Op,
  input: Readonly<Record<string, string>>,
): { readonly tool: string; readonly args: object } => {
  const thread = input["thread"]
  switch (op) {
    case "create":
      return { tool: "thread_create", args: { device: input["device"], prompt: input["prompt"] } }
    case "send":
      return {
        tool: "thread_send",
        args: {
          thread,
          message: input["message"],
          delivery: input["delivery"],
          ...(input["expected_turn_id"] === undefined ? {} : { expected_turn_id: input["expected_turn_id"] }),
          ...(input["idempotency_key"] === undefined ? {} : { idempotency_key: input["idempotency_key"] }),
        },
      }
    case "read":
      return { tool: "thread_read", args: { thread } }
    case "interrupt":
      return { tool: "thread_interrupt", args: { thread } }
    case "setModel":
      return { tool: "thread_set_model", args: { thread, model: input["model"] } }
    case "setReasoning":
      return { tool: "thread_set_reasoning", args: { thread, level: input["level"] } }
    case "close":
      return { tool: "thread_close", args: { thread } }
  }
}

/** The agent session on device A, as the run gives it: one prompt in, the named tool's result text out. */
export type ToolSession = {
  readonly prompt: (text: string, tool: string, signal?: AbortSignal) => Promise<string>
}

const directive = (tool: string, args: object): string =>
  `QA:CALL ${tool} ${Buffer.from(JSON.stringify(args), "utf8").toString("base64url")}`

// A tool result reaches the model as the tool's text, `{ details: { result } }` or the result itself.
const resultOf = (text: string): unknown => {
  try {
    const parsed: unknown = JSON.parse(text)
    if (isRecord(parsed) && isRecord(parsed["details"]) && "result" in parsed["details"])
      return parsed["details"]["result"]
    return parsed
  } catch {
    return { text }
  }
}

export function createToolsDriver(session: ToolSession): Driver {
  return {
    mapping: MAPPING,
    run: async ({ op, input }: Call, signal?: AbortSignal): Promise<Answer> => {
      const { tool, args } = toolCall(op, input)
      const raw = resultOf(await session.prompt(directive(tool, args), tool, signal))
      const thread = threadOf(raw)
      return {
        call: `${tool} ${JSON.stringify(args)}`,
        raw,
        answered: succeeded(raw),
        ...(thread === undefined ? {} : { thread }),
      }
    },
    close: async () => {},
  }
}
