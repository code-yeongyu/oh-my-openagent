#!/usr/bin/env node
// Real-surface QA for the todo-fanout-reminder component: loads the BUILT
// plugin/extensions/omo.js the way senpi's extension loader does (default-export
// factory called with the ExtensionAPI), arms ultrawork through the real input
// path, then fires the session's first todo tool_result and asserts the
// <system-reminder> transform. Exits non-zero on any failed expectation.
//
// Isolation: run with HOME pointed at a throwaway dir so config-startup migration
// and config loading never touch the real ~/.omo. Telemetry is opted out via env.
//
// Usage: node packages/omo-senpi/scripts/qa/todo-fanout-reminder-e2e.mjs
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

const bundlePath = resolve("packages/omo-senpi/plugin/extensions/omo.js")

function createFakePi() {
  const handlers = []
  const messages = []
  const flagValues = new Map()
  return {
    handlers,
    messages,
    on(event, handler) { handlers.push({ event, handler }) },
    registerFlag(name, options) { if (!flagValues.has(name)) flagValues.set(name, options?.default) },
    getFlag(name) { return flagValues.get(name) },
    registerTool() {},
    registerCommand() {},
    registerMessageRenderer() {},
    sendMessage(message, options) { messages.push({ message, options }) },
    sendUserMessage() {},
    async dispatch(event, payload, ctx) {
      const results = []
      for (const registration of handlers) {
        if (registration.event !== event) continue
        results.push(await registration.handler(payload, ctx))
      }
      return results
    },
  }
}

const sessionCtx = (sessionId) => ({ sessionManager: { getSessionId: () => sessionId }, cwd: process.cwd() })

const todoResult = (op) => ({
  type: "tool_result",
  toolCallId: `tc-${op}`,
  toolName: "todo",
  input: { op },
  content: [{ type: "text", text: `todo ${op} ok` }],
  isError: false,
  details: {},
})

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
}

const mod = await import(pathToFileURL(bundlePath).href)
const factory = mod.default
if (typeof factory !== "function") {
  console.error(JSON.stringify({ verdict: "FAIL", reason: "bundle has no default-export factory" }))
  process.exit(1)
}

const pi = createFakePi()
await factory(pi)

// Arm ultrawork for session s-1 through the real input path.
await pi.dispatch("input", { type: "input", text: "ulw prove the fan-out reminder", source: "interactive" }, sessionCtx("s-1"))
const armed = pi.messages.some((m) => m.message?.customType === "omo-ultrawork:directive")
check("ulw input arms session via hidden directive message", armed, { messages: pi.messages.length })

// Every composed component's tool_result handler runs per dispatch, so scan ALL
// handler results for the reminder transform instead of assuming index 0.
const reminderFrom = (results) =>
  results.find((r) => Array.isArray(r?.content) && r.content.some((b) => typeof b?.text === "string" && b.text.includes("<system-reminder>")))

// First task-adding todo result in the armed session -> exactly one reminder transform.
const firstResults = await pi.dispatch("tool_result", todoResult("init"), sessionCtx("s-1"))
const first = reminderFrom(firstResults)
const firstText = first?.content?.[first.content.length - 1]?.text ?? ""
check("first todo init result carries appended <system-reminder>", firstText.includes("<system-reminder>") && firstText.includes("fan-out") && firstText.includes("fresh"), { blocks: first?.content?.length, handlerResults: firstResults.length })

// Second todo result in the same session -> no duplicate.
const secondResults = await pi.dispatch("tool_result", todoResult("append"), sessionCtx("s-1"))
check("second todo result in same session is untransformed", reminderFrom(secondResults) === undefined, { handlerResults: secondResults.length })

// Unarmed session -> no reminder.
const unarmedResults = await pi.dispatch("tool_result", todoResult("init"), sessionCtx("s-2"))
check("unarmed session gets no reminder", reminderFrom(unarmedResults) === undefined, { handlerResults: unarmedResults.length })

const failed = results.filter((r) => !r.ok)
const verdict = failed.length === 0 ? "PASS" : "FAIL"
console.log(JSON.stringify({ verdict, surface: "built plugin/extensions/omo.js via senpi loader contract", results }, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
