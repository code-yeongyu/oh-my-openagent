import { createHash } from "node:crypto"
import { observeMockSignal, recordMockEvent } from "./task-host-e2e-audit.mjs"
import registerBase, {
  loadMockScript, messagesContainChild, stepToAssistantMessage,
} from "./task-e2e-mock-provider.ts"

let requestNumber = 0 // Correlation only; this never chooses a script step.
// A daemon shares extension modules across sessions. Advance from this conversation's receipts,
// never a module-global cursor; a changed script starts a new sequence on a resumed conversation.
function nextStep(steps, context) {
  const key = createHash("sha256").update(JSON.stringify(steps)).digest("hex").slice(0, 16)
  const prefix = `omo-host-${key}-`
  let index = 0
  for (const message of context.messages ?? []) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part.type === "toolCall" && part.id?.startsWith(prefix)) {
        index = Math.max(index, Number(part.id.slice(prefix.length).split("-")[0]) + 1)
      }
    }
  }
  index = Math.min(index, steps.length - 1)
  return { step: { ...steps[index], id: `${prefix}${index}-${process.pid}-${++requestNumber}` }, index }
}

function emissionReady(delayMs, signal) {
  if (!delayMs) return Promise.resolve()
  return new Promise((resolve) => {
    const ready = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", ready)
      resolve()
    }
    const timer = setTimeout(ready, delayMs)
    signal?.addEventListener("abort", ready, { once: true })
    if (signal?.aborted) ready()
  })
}

function scriptedStream(model, context, steps, options) {
  const { step, index } = nextStep(steps, context)
  const message = stepToAssistantMessage(step, index + 1, model.id)
  observeMockSignal(context.cwd ?? process.cwd(), step.id, options?.signal)
  const result = emissionReady(step.delayMs, options?.signal).then(() =>
    options?.signal?.aborted ? { ...message, stopReason: "aborted" } : message)
  return {
    result: () => result,
    async *[Symbol.asyncIterator]() {
      const final = await result
      if (final.stopReason === "aborted") {
        yield { type: "error", reason: "aborted", error: final }
        return
      }
      yield { type: "start", partial: { ...final, content: [] } }
      if (step.type === "text") {
        yield { type: "text_start", contentIndex: 0, partial: { ...final, content: [{ type: "text", text: "" }] } }
        yield { type: "text_delta", contentIndex: 0, delta: step.text, partial: final }
        yield { type: "text_end", contentIndex: 0, content: step.text, partial: final }
      } else {
        yield { type: "toolcall_start", contentIndex: 0, partial: { ...final, content: [] } }
        yield { type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(step.arguments), partial: final }
        yield { type: "toolcall_end", contentIndex: 0, toolCall: final.content[0], partial: final }
      }
      yield { type: "done", reason: final.stopReason, message: final }
    },
  }
}

export default function registerTaskHostMock(pi) {
  pi.on?.("agent_end", (event, context) => {
    recordMockEvent(context.cwd, {
      type: "agent_end", sessionId: context.sessionManager.getSessionId(),
      aborted: event.aborted ?? null, abortSource: event.abortSource ?? null, willRetry: event.willRetry ?? null,
      stopReason: event.messages.findLast((message) => message.role === "assistant")?.stopReason ?? null,
    })
  })
  pi.on?.("session_shutdown", (event, context) => {
    recordMockEvent(context.cwd, {
      type: "session_shutdown", sessionId: context.sessionManager.getSessionId(), reason: event.reason,
    })
  })
  registerBase({
    on: pi.on?.bind(pi),
    sendMessage: pi.sendMessage?.bind(pi),
    registerProvider(id, provider) {
      pi.registerProvider(id, {
        ...provider,
        streamSimple(model, context, options) {
          const script = loadMockScript(context.cwd ?? process.cwd())
          const child = messagesContainChild(context) || process.argv.includes("rpc")
          if (child && script.failChildModels?.includes(model.id)) {
            return provider.streamSimple(model, context, options)
          }
          return scriptedStream(model, context, child ? script.childSteps : script.parentSteps, options)
        },
      })
    },
  })
}
