export function evalSmokeProviderSource(receiptPath) {
  return `
import { appendFileSync } from "node:fs"
const receiptPath = ${JSON.stringify(receiptPath)}
const model = {
  id: "gpt-5.6-sol", name: "Eval Smoke", reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000, maxTokens: 4096,
}
const cells = [
  { language: "js", code: "var packagedSentinel = 41; print('JS_OK', packagedSentinel + 1); display(await tool.read({ path: 'fixture.txt' }))", summary: "Run packaged JavaScript and host read" },
  { language: "py", code: "packaged_sentinel = 41\\nprint('PY_OK', packaged_sentinel + 1)\\nimport os\\nprint('PY_PID', os.getpid())", summary: "Run packaged Python" },
  { action: "list", summary: "List packaged cells" },
]
export default function register(pi) {
  for (const kind of ["tool_call", "tool_result"]) {
    pi.on(kind, (event) => {
      if (event.toolName !== "read") return
      appendFileSync(receiptPath, JSON.stringify({
        kind, id: event.toolCallId, input: event.input,
        isError: event.isError, content: event.content,
      }) + "\\n")
      if (kind === "tool_call" && event.input.path !== "fixture.txt") {
        return { block: true, reason: "Unexpected packaged smoke read" }
      }
    })
  }
  pi.registerProvider("openai", {
    name: "Eval Smoke", baseUrl: "file://eval-smoke", apiKey: "mock",
    api: "openai-completions", models: [model],
    streamSimple(_model, context, options) {
      const used = context.messages.filter((message) => message.role === "toolResult" && message.toolName === "eval")
      const args = used.some((message) => message.isError) ? undefined : cells[used.length]
      return stream(args, used.length, options)
    },
  })
}
function stream(args, index, options) {
  const content = args === undefined
    ? [{ type: "text", text: "eval smoke complete" }]
    : [{ type: "toolCall", id: "eval-smoke-" + index, name: "eval", arguments: args }]
  const final = {
    role: "assistant", content, api: "openai-completions", provider: "openai", model: model.id,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: options?.signal?.aborted ? "aborted" : args === undefined ? "stop" : "toolUse",
    timestamp: Date.now(),
  }
  return {
    result: () => Promise.resolve(final),
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: { ...final, content: [] } }
      if (args === undefined) {
        yield { type: "text_start", contentIndex: 0, partial: final }
        yield { type: "text_delta", contentIndex: 0, delta: content[0].text, partial: final }
        yield { type: "text_end", contentIndex: 0, content: content[0].text, partial: final }
      } else {
        yield { type: "toolcall_start", contentIndex: 0, partial: final }
        yield { type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(args), partial: final }
        yield { type: "toolcall_end", contentIndex: 0, toolCall: content[0], partial: final }
      }
      yield { type: "done", reason: final.stopReason, message: final }
    },
  }
}
`
}
