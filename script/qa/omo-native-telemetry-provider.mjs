import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
export const pluginRoot = join(repoRoot, "packages", "omo-senpi", "plugin")
export const prompts = [
  "ulw plan: list the repo top-level files by delegating one quick task, and track it with a goal",
  "Read one packaged builtin SKILL.md and summarize its purpose briefly.",
  "Acknowledge this third telemetry QA request briefly.",
]
export function mockProviderSource() {
  return `import { join } from "node:path"
const builtinSkillPath = process.env.OMO_PACKAGE_DIR ? join(process.env.OMO_PACKAGE_DIR, "plugin", "skills", "debugging", "SKILL.md") : ${JSON.stringify(join(pluginRoot, "skills", "debugging", "SKILL.md"))}
const model = { id: "gpt-5.6-sol", name: "GPT 5.6 Sol QA", reasoning: false, input: ["text"], cost: { input: 0.000001, output: 0.000002, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 4096 }
const PROMPT_A = ${JSON.stringify(prompts[0])}
const PROMPT_B = ${JSON.stringify(prompts[1])}
const PROMPT_C = ${JSON.stringify(prompts[2])}
const CHILD = "List the repository top-level entries and report them briefly."
export default function register(pi) {
  pi.registerProvider("openai", { name: "OpenAI local telemetry QA", baseUrl: "file://telemetry-qa", apiKey: "mock", api: "openai-completions", models: [model], streamSimple(_model, context, options) { return stream(stepFor(context), options) } })
}
function stepFor(context) {
  const messages = Array.isArray(context?.messages) ? context.messages : []
  const joined = JSON.stringify(messages)
  const promptAIndex = joined.lastIndexOf(PROMPT_A)
  const promptBIndex = joined.lastIndexOf(PROMPT_B)
  const promptCIndex = joined.lastIndexOf(PROMPT_C)
  const latestPromptIndex = Math.max(promptAIndex, promptBIndex, promptCIndex)
  if (latestPromptIndex === -1 && joined.includes(CHILD)) return { type: "text", text: "Child listed the repository entries." }
  if (promptAIndex === latestPromptIndex) {
    const toolNames = messages.flatMap((message) => message?.role === "assistant" && Array.isArray(message.content) ? message.content.filter((item) => item?.type === "toolCall").map((item) => item.name) : [])
    if (!toolNames.includes("create_goal")) return { type: "tool_call", name: "create_goal", arguments: { objective: "List repository entries with one delegated quick task and keep the run tracked by a goal." } }
    if (!toolNames.includes("task")) return { type: "tool_call", name: "task", arguments: { category: "quick", prompt: CHILD, run_in_background: true, name: "telemetry-qa-child" } }
    if (!toolNames.includes("update_goal")) return { type: "tool_call", name: "update_goal", arguments: { status: "complete" } }
    return { type: "text", text: "The goal and delegated listing task were started and the requested tracking goal was completed." }
  }
  if (promptBIndex === latestPromptIndex) {
    const readUsed = messages.some((message) => message?.role === "assistant" && Array.isArray(message.content) && message.content.some((item) => item?.type === "toolCall" && item.name === "read"))
    if (!readUsed) return { type: "tool_call", name: "read", arguments: { path: builtinSkillPath } }
    return { type: "text", text: "The builtin debugging skill describes a disciplined debugging workflow." }
  }
  if (promptCIndex === latestPromptIndex) return { type: "text", text: "Telemetry QA control prompt completed." }
  return { type: "text", text: "Local QA child completed." }
}
function message(step, callCount) {
  const content = step.type === "text" ? [{ type: "text", text: step.text }] : [{ type: "toolCall", id: "telemetry-qa-tool-" + callCount, name: step.name, arguments: step.arguments }]
  return { role: "assistant", content, api: "openai-completions", provider: "openai", model: "gpt-5.6-sol", usage: { input: 12, output: 8, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 20, cost: { input: 0.000012, output: 0.000016, cacheRead: 0, cacheWrite: 0, total: 0.000028 } }, stopReason: step.type === "tool_call" ? "toolUse" : "stop", timestamp: Date.now() }
}
let calls = 0
function stream(step, options) {
  const queue = []; const waiters = []; let done = false; let resolveResult; let rejectResult
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject }); result.catch(() => {})
  const output = { push(event) { if (done) return; const waiter = waiters.shift(); if (waiter) waiter({ value: event, done: false }); else queue.push(event) }, end(final) { if (done) return; done = true; resolveResult(final); while (waiters.length) waiters.shift()({ value: undefined, done: true }) }, fail(error) { if (done) return; done = true; rejectResult(error); while (waiters.length) waiters.shift()({ value: undefined, done: true }) }, result() { return result }, [Symbol.asyncIterator]() { return { next() { if (queue.length) return Promise.resolve({ value: queue.shift(), done: false }); if (done) return Promise.resolve({ value: undefined, done: true }); return new Promise((resolve) => waiters.push(resolve)) } } } }
  calls += 1; const final = message(step, calls)
  queueMicrotask(() => { if (options?.signal?.aborted) { output.end({ ...final, stopReason: "aborted" }); return } output.push({ type: "start", partial: { ...final, content: [] } }); if (step.type === "text") { output.push({ type: "text_start", contentIndex: 0, partial: { ...final, content: [{ type: "text", text: "" }] } }); output.push({ type: "text_delta", contentIndex: 0, delta: step.text, partial: final }); output.push({ type: "text_end", contentIndex: 0, content: step.text, partial: final }) } else { const toolCall = final.content[0]; output.push({ type: "toolcall_start", contentIndex: 0, partial: final }); output.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(step.arguments), partial: final }); output.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: final }) } output.push({ type: "done", reason: final.stopReason, message: final }); output.end(final) })
  return output
}
`
}
