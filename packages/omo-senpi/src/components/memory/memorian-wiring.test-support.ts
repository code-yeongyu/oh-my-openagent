import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { createMemorianGateWiring, type MemorianGatePort } from "./memorian-wiring"

export const IDENTITY = "memorian-agent"
export const SESSION_ID = "session-gate-1"
export const CANDIDATE_PATH = "reference/kubernetes-rollouts.md"
export const roots: string[] = []

export async function context(): Promise<MemoryIdentityContext> {
  return createMemoryIdentityContext({
    identity: IDENTITY,
    identityPaths: buildIdentityPaths("/tmp/omo-memorian-wiring", IDENTITY),
    binding: createMemoryBinding({ identity: IDENTITY, repoPath: "/tmp/omo-memorian-wiring/repo", boundAt: 0 }),
  })
}

type GateInput = {
  readonly identity?: MemoryIdentityContext
  readonly launches: Array<Parameters<MemorianGatePort["launch"]>[0]>
  readonly cancel?: () => Promise<void>
  readonly whenIdle?: () => Promise<void>
}

export function gate(input: GateInput) {
  return createMemorianGateWiring({
    resolveContext: () => input.identity,
    runnerFor: () => ({
      launch: async () => ({ status: "empty" }),
      ...(input.cancel === undefined ? {} : { cancel: input.cancel }),
      ...(input.whenIdle === undefined ? {} : { whenIdle: input.whenIdle }),
    }),
  })
}
