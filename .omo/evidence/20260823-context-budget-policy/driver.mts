import { createPreemptiveCompactionHook } from "../../../packages/omo-opencode/src/hooks/preemptive-compaction"
import type { OhMyOpenCodeConfig } from "../../../packages/omo-opencode/src/config"

console.log("===== PREEMPTIVE COMPACTION HOOK LIVE QA DRIVER =====")

let summarizeCallCount = 0
let lastSummarizedSessionId = ""
const summarizeCalls: Array<{ sessionId: string; timestamp: number }> = []

const mockClient = {
  session: {
    summarize: async ({ path }: { path: { id: string } }) => {
      summarizeCallCount++
      lastSummarizedSessionId = path.id
      summarizeCalls.push({ sessionId: path.id, timestamp: Date.now() })
      return { status: 200, data: { ok: true } }
    },
    messages: async () => {
      throw new Error("hook must not call session.messages() directly")
    },
  },
} as any

const pluginConfig: OhMyOpenCodeConfig = {
  experimental: {
    context_budget: {
      max_active_context_tokens: 384000,
      warmup_fraction: 0.75,
      reserve_tokens: 16384,
    },
  },
}

const mockModelCache = {
  anthropicContext1MEnabled: true,
  modelContextLimitsCache: new Map([
    ["anthropic/claude-opus-5", 1048576],
  ]),
} as any

const hook = createPreemptiveCompactionHook(
  { client: mockClient, directory: "/tmp/qa" } as any,
  pluginConfig,
  mockModelCache,
)

const sessionID = "live-qa-sess-" + Date.now()

// Phase 1: 1M model at 250,000 tokens (< 288k warmup trigger = 384k * 0.75)
console.log("\n[Test 1] message.updated at 250k tokens (Below 288k warmup trigger)")
await hook.event({
  event: {
    type: "message.updated",
    properties: {
      info: {
        id: "msg-1",
        role: "assistant",
        sessionID,
        finish: "stop",
        providerID: "anthropic",
        modelID: "claude-opus-5",
        tokens: {
          input: 240000,
          output: 10000,
          total: 250000,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      },
    },
  },
})

await hook["tool.execute.after"](
  { tool: "readFile", sessionID, callID: "c1" },
  { title: "test", output: "ok", metadata: {} },
)

console.log(`Summarize calls after 250k: ${summarizeCallCount} (Expected: 0)`)
if (summarizeCallCount !== 0) throw new Error("Triggered premature compaction below warmup threshold")

// Phase 2: 1M model reaches 305,000 tokens (> 288k warmup trigger = 384k * 0.75)
console.log("\n[Test 2] message.updated reaches 305k tokens (> 288k warmup trigger)")
await hook.event({
  event: {
    type: "message.updated",
    properties: {
      info: {
        id: "msg-2",
        role: "assistant",
        sessionID,
        finish: "stop",
        providerID: "anthropic",
        modelID: "claude-opus-5",
        tokens: {
          input: 300000,
          output: 5000,
          total: 305000,
          reasoning: 0,
          cache: { read: 5000, write: 0 },
        },
      },
    },
  },
})

await hook["tool.execute.after"](
  { tool: "readFile", sessionID, callID: "c2" },
  { title: "test", output: "ok", metadata: {} },
)

console.log(`Summarize calls after 305k: ${summarizeCallCount} (Expected: 1)`)
console.log(`Last summarized session: ${lastSummarizedSessionId} (Expected: ${sessionID})`)
if (summarizeCallCount !== 1 || lastSummarizedSessionId !== sessionID) {
  throw new Error("Failed to trigger compaction at warmup boundary")
}

// Phase 3: session.compacted event invalidates cached tokens & transitions lifecycle
console.log("\n[Test 3] session.compacted cache invalidation & idempotency")
await hook.event({
  event: {
    type: "session.compacted",
    properties: {
      sessionID,
    },
  },
})

// Subsequent tool execution without fresh message update should NOT re-trigger
await hook["tool.execute.after"](
  { tool: "readFile", sessionID, callID: "c3" },
  { title: "test", output: "ok", metadata: {} },
)

console.log(`Summarize calls after session.compacted: ${summarizeCallCount} (Expected: 1, no duplicate trigger)`)
if (summarizeCallCount !== 1) throw new Error("Duplicate compaction triggered after compaction completion")

console.log("\n===== LIVE QA DRIVER VERDICT: ALL ASSERTIONS PASSED (100%) =====")
