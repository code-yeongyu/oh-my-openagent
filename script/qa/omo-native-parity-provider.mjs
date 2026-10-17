// Extension source a parity sandbox loads: a scripted openai-completions provider that replays the
// scenario's tool calls one per turn and records every request it serves.
export function parityProviderSource() {
  return `
import { appendFileSync, readFileSync } from "node:fs"
const STEPS = JSON.parse(readFileSync(process.env.OMO_PARITY_STEPS, "utf8"))
const LOG = process.env.OMO_PARITY_LOG
const MODEL = { id: "gpt-5.6-sol", name: "Parity", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 4096 }
function nextStep(context) {
  const messages = Array.isArray(context?.messages) ? context.messages : []
  const answered = messages.filter((message) => message?.role === "toolResult").length
  appendFileSync(LOG, JSON.stringify({ answered, tools: (context?.tools ?? []).map((tool) => tool.name).sort() }) + "\\n")
  const step = STEPS[answered]
  return step === undefined ? { type: "text", text: "parity complete" } : { type: "tool_call", name: step.tool, arguments: step.arguments }
}
function message(step, index) {
  const content = step.type === "text" ? [{ type: "text", text: step.text }] : [{ type: "toolCall", id: "parity-" + index, name: step.name, arguments: step.arguments }]
  return { role: "assistant", content, api: "openai-completions", provider: "openai", model: MODEL.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: step.type === "text" ? "stop" : "toolUse", timestamp: Date.now() }
}
let calls = 0
function stream(step, options) {
  const queue = []; const waiters = []; let done = false; let settle
  const result = new Promise((resolve) => { settle = resolve })
  const output = {
    push(event) { if (done) return; const waiter = waiters.shift(); if (waiter) waiter({ value: event, done: false }); else queue.push(event) },
    end(final) { if (done) return; done = true; settle(final); while (waiters.length) waiters.shift()({ value: undefined, done: true }) },
    result() { return result },
    [Symbol.asyncIterator]() { return { next() { if (queue.length) return Promise.resolve({ value: queue.shift(), done: false }); if (done) return Promise.resolve({ value: undefined, done: true }); return new Promise((resolve) => waiters.push(resolve)) } } },
  }
  calls += 1
  const final = message(step, calls)
  queueMicrotask(() => {
    if (options?.signal?.aborted) { output.end({ ...final, stopReason: "aborted" }); return }
    output.push({ type: "start", partial: { ...final, content: [] } })
    if (step.type === "text") {
      output.push({ type: "text_start", contentIndex: 0, partial: { ...final, content: [{ type: "text", text: "" }] } })
      output.push({ type: "text_delta", contentIndex: 0, delta: step.text, partial: final })
      output.push({ type: "text_end", contentIndex: 0, content: step.text, partial: final })
    } else {
      output.push({ type: "toolcall_start", contentIndex: 0, partial: final })
      output.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(step.arguments), partial: final })
      output.push({ type: "toolcall_end", contentIndex: 0, toolCall: final.content[0], partial: final })
    }
    output.push({ type: "done", reason: final.stopReason, message: final })
    output.end(final)
  })
  return output
}
export default function register(pi) {
  pi.registerProvider("openai", { name: "Parity", baseUrl: "file://parity", apiKey: "parity", api: "openai-completions", models: [MODEL], streamSimple(_model, context, options) { return stream(nextStep(context), options) } })
}
`
}
