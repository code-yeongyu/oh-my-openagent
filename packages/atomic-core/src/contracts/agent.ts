import * as z from "zod"

export const ATOMIC_HOOK_VERBS = {
  codex: ["session-start", "user-prompt-submit", "pre-tool", "post-tool", "stop", "session-end"],
  pi: ["session-start", "user-prompt", "before-tool", "after-tool", "stop", "session-end"],
  opencode: ["session-start", "user-prompt", "before-tool", "after-tool", "stop", "session-end"],
} as const

export type AtomicHookAgent = keyof typeof ATOMIC_HOOK_VERBS
export type AtomicHookVerb<A extends AtomicHookAgent> = (typeof ATOMIC_HOOK_VERBS)[A][number]

/** As Atomic's own integrations ship: every OpenCode verb and the Codex stop verb run with --foreground. */
export function atomicHookRunsInForeground(agent: AtomicHookAgent, verb: string): boolean {
  switch (agent) {
    case "opencode":
      return true
    case "codex":
      return verb === "stop"
    case "pi":
      return false
    default: {
      const unreachable: never = agent
      return unreachable
    }
  }
}

export const AtomicAgentStatusSchema = z.object({
  agents: z.array(
    z.object({ name: z.string(), display_name: z.string(), detected: z.boolean(), hooks_installed: z.boolean() }),
  ),
  sessions: z.array(
    z.looseObject({ session_id: z.string(), agent_display_name: z.string(), active: z.boolean() }),
  ),
  totals: z.object({ sessions: z.number(), turns: z.number(), files_touched: z.number() }),
  hook_health: z
    .array(z.looseObject({ name: z.string(), last_fired: z.string().nullable(), last_error: z.string().nullable() }))
    .optional(),
  hook_sessions: z.array(z.looseObject({ agent: z.string(), session_id: z.string() })).optional(),
  silent_agents: z.array(z.string()).optional(),
})

export const AtomicLifecycleStatusSchema = z.object({
  active: z.boolean(),
  interrupted: z.boolean(),
  lifecycles: z.array(z.record(z.string(), z.unknown())),
  stale_lifecycles: z.array(z.record(z.string(), z.unknown())),
  turns: z.array(z.record(z.string(), z.unknown())),
})

export type AtomicAgentStatus = z.infer<typeof AtomicAgentStatusSchema>
export type AtomicLifecycleStatus = z.infer<typeof AtomicLifecycleStatusSchema>
