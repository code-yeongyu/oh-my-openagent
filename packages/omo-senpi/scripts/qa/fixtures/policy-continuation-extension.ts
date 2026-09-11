import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"

import { createUlwLoopComponent } from "../../../src/components/ulw-loop"
import { createUlwExecuteContinuationComponent } from "../../../src/components/ulw-execute-continuation"
import { IdleInjectionCoordinator } from "../../../src/extension/idle-injection-coordinator"
import type { SenpiExtensionAPI } from "../../../src/extension/types"

// The driver supplies the window per lane: the compaction lane is only a compaction lane while the
// host measures the reported usage against a window this session can actually exceed.
const QA_CONTEXT_WINDOW = Number(process.env.OMO_POLICY_QA_CONTEXT_WINDOW ?? 200_000)

type QaAPI = SenpiExtensionAPI & {
  registerProvider(name: string, provider: Record<string, unknown>): void
}

// Loaded by the real Senpi CLI; only the provider is fake. Both production hooks and
// the production coordinator are bundled from this checkout, not reimplemented.
export default async function policyContinuationExtension(pi: QaAPI): Promise<void> {
  const artifact = process.env.OMO_POLICY_QA_TRACE
  const toolkit = process.env.OMO_AGENT_TOOLKIT_BIN
  const endpoint = process.env.OMO_POLICY_QA_ENDPOINT
  if (!artifact || !toolkit || !endpoint) throw new Error("policy QA requires trace, toolkit and endpoint")
  const record = (event: Record<string, unknown>) => appendFileSync(artifact, `${JSON.stringify(event)}\n`)
  const coordinator = new IdleInjectionCoordinator((message, options) => {
    record({ type: "omo_send", message, options })
    return pi.sendMessage(message, { triggerTurn: true, deliverAs: options.deliverAs })
  })
  const logger = {
    info: (message: string, details?: unknown) => record({ type: "log", message, details }),
    warn: (message: string, details?: unknown) => record({ type: "warning", message, details }),
    error: (message: string, details?: unknown) => record({ type: "error", message, details }),
  }
  pi.on("session_start", (_event, ctx) => {
    if (!isRecord(ctx) || typeof ctx["cwd"] !== "string") throw new Error("missing session cwd")
    const manager = ctx["sessionManager"]
    if (!isRecord(manager) || typeof manager["getSessionId"] !== "function") throw new Error("missing session manager")
    const sessionId: unknown = manager["getSessionId"]()
    if (typeof sessionId !== "string") throw new Error("missing session id")
    const cwd = ctx["cwd"]
    const lane = process.env.OMO_POLICY_QA_LANE
    if (lane === "loop") {
      execFileSync(toolkit, ["ulw-loop", "create-goals", "--brief", "- QA active continuation", "--json", "--session-id", sessionId], { cwd })
    } else if (lane === "boulder") {
      mkdirSync(join(cwd, ".omo", "plans"), { recursive: true })
      writeFileSync(join(cwd, ".omo", "plans", "qa.md"), "## TODOs\n- [ ] 1. QA active continuation\n")
      writeFileSync(join(cwd, ".omo", "boulder.json"), JSON.stringify({
        schema_version: 2, active_work_id: "qa", works: { qa: {
          work_id: "qa", active_plan: ".omo/plans/qa.md", plan_name: "qa", session_ids: [`senpi:${sessionId}`],
          status: "active", started_at: "2026-09-09T00:00:00Z",
        } },
      }))
    } else throw new Error("unknown QA lane")
    record({ type: "active_plan", lane, sessionId, cwd })
  })
  // Edge markers registered BEFORE the components, so the trace records when each host edge OPENED
  // regardless of handler order: the host awaits each handler, so a send scheduled by a hook can
  // land before the next handler runs. An `omo_send` recorded while the open edge is still
  // `agent_end` rode an edge the host had not settled.
  pi.on("agent_end", (event) => record({ type: "edge_agent_end", willRetry: readFlag(event, "willRetry"), aborted: readFlag(event, "aborted") }))
  pi.on("agent_settled", () => record({ type: "edge_agent_settled" }))

  const context = { logger, config: { getFlag: () => false }, idleCoordinator: coordinator }
  await createUlwExecuteContinuationComponent().register(pi, context)
  await createUlwLoopComponent({ resolveOmoBin: () => toolkit }).register(pi, context)
  // Recorded AFTER the components register, so each line reports the queue state the hooks left
  // behind on that edge. `hook_compact` is the host's own compaction interaction.
  pi.on("agent_end", (event) => record({ type: "hook_end", event, pending: coordinator.pendingCount() }))
  pi.on("agent_settled", () => record({ type: "hook_settled", pending: coordinator.pendingCount() }))
  pi.on("session_compact", (event) => record({ type: "hook_compact", event }))

  pi.registerProvider("omo-policy-qa", {
    baseUrl: endpoint, apiKey: "local-qa-only", api: "openai-completions",
    models: [{ id: "qa", name: "QA", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: QA_CONTEXT_WINDOW, maxTokens: 1024 }],
    streamSimple() {
      // Actual HTTP boundary, with a bounded request; no credentials or real model service.
      const result = fetch(endpoint, { signal: AbortSignal.timeout(10_000) }).then(async (response) => {
        if (!response.ok) throw new Error(`QA provider HTTP ${response.status}`)
        const outcome: unknown = await response.json()
        if (!isRecord(outcome) || typeof outcome["stopReason"] !== "string") throw new Error("malformed QA provider outcome")
        return { role: "assistant", content: [], api: "openai-completions", provider: "omo-policy-qa", model: "qa",
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: Date.now(), ...outcome, stopReason: outcome["stopReason"] }
      })
      return {
        result: () => result,
        async *[Symbol.asyncIterator]() {
          const message = await result
          yield { type: "start", partial: message }
          if (message["stopReason"] === "error" || message["stopReason"] === "aborted") {
            yield { type: "error", reason: message["stopReason"], error: message }
          } else yield { type: "done", reason: message["stopReason"], message }
        },
      }
    },
  })
  record({ type: "loaded", components: ["ulw-execute-continuation", "ulw-loop"], coordinator: "IdleInjectionCoordinator" })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readFlag(event: unknown, key: string): boolean {
  return isRecord(event) && event[key] === true
}
