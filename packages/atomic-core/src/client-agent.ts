import {
  type AtomicAgentStatus,
  AtomicAgentStatusSchema,
  type AtomicHookAgent,
  type AtomicHookVerb,
  type AtomicLifecycleStatus,
  AtomicLifecycleStatusSchema,
  atomicHookRunsInForeground,
  parseJsonContract,
} from "./contracts"
import type { AtomicCallOptions, AtomicRunner } from "./client-runner"

export type AtomicHookDispatch<A extends AtomicHookAgent> = AtomicCallOptions & {
  readonly agent: A
  readonly verb: AtomicHookVerb<A>
  readonly payload: Readonly<Record<string, unknown>>
  readonly timeoutMs: number
}

export type AtomicAgentOperations = {
  agentStatus(call: AtomicCallOptions): Promise<AtomicAgentStatus>
  lifecycleStatus(call: AtomicCallOptions): Promise<AtomicLifecycleStatus>
  dispatchHook<A extends AtomicHookAgent>(call: AtomicHookDispatch<A>): Promise<void>
}

export function createAgentOperations(run: AtomicRunner): AtomicAgentOperations {
  return {
    async agentStatus(call) {
      const stdout = await run({ operation: "agent status", args: ["agent", "status", "--json"], mutation: false }, call)
      return parseJsonContract(AtomicAgentStatusSchema, stdout, { operation: "agent status", sideEffectsPossible: false })
    },
    async lifecycleStatus(call) {
      const args = ["agent", "lifecycle", "status", "--json"]
      const stdout = await run({ operation: "agent lifecycle status", args, mutation: false }, call)
      return parseJsonContract(AtomicLifecycleStatusSchema, stdout, {
        operation: "agent lifecycle status",
        sideEffectsPossible: false,
      })
    },
    async dispatchHook(call) {
      const foreground = atomicHookRunsInForeground(call.agent, call.verb) ? ["--foreground"] : []
      const command = {
        operation: `agent hooks ${call.agent} ${call.verb}`,
        args: ["agent", "hooks", call.agent, call.verb, ...foreground],
        mutation: true,
        timeoutMs: call.timeoutMs,
        stdin: JSON.stringify(call.payload),
      }
      await run(command, call)
    },
  }
}
