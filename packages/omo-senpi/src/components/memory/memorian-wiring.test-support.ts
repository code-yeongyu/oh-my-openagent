import { mkdtemp } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, type RecallCandidate } from "@oh-my-opencode/memory-core"

import { ModelRegistry, ModelRuntime } from "../../senpi-test-runtime"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { createMemorianGateWiring, type MemorianGatePort } from "./memorian-wiring"
import type { CollectedRecallCandidates } from "./recall-wiring"

export const IDENTITY = "memorian-agent"
export const SESSION_ID = "session-gate-1"
export const CANDIDATE_PATH = "reference/kubernetes-rollouts.md"
export const roots: string[] = []

export const CANDIDATES: readonly RecallCandidate[] = [
  { path: CANDIDATE_PATH, description: "Rollout policy", excerpt: "drain first", score: 1 },
]

export async function context(): Promise<MemoryIdentityContext> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memorian-wiring-")))
  roots.push(root)
  return createMemoryIdentityContext({
    identity: IDENTITY,
    identityPaths: buildIdentityPaths(root, IDENTITY),
    binding: createMemoryBinding({ identity: IDENTITY, repoPath: join(root, "repo"), boundAt: 0 }),
  })
}

export function collected(identity: MemoryIdentityContext): CollectedRecallCandidates {
  return {
    sessionId: SESSION_ID,
    context: identity,
    candidates: CANDIDATES,
    surfaced: new Set<string>(),
    maxItems: 2,
    transcript: [{ role: "user", text: "how do we handle kubernetes rollouts" }],
  }
}

type Launch = Parameters<MemorianGatePort["launch"]>[0]

export function gate(input: {
  readonly collect: () => Promise<CollectedRecallCandidates | undefined>
  readonly launches: Launch[]
  readonly identity?: MemoryIdentityContext
  readonly launch?: MemorianGatePort["launch"]
  readonly cancel?: () => Promise<void>
  readonly whenIdle?: () => Promise<void>
  readonly logs?: Array<{ message: string, details?: unknown }>
  readonly entries?: Array<{ customType: string; data: unknown }>
}) {
  const wiring = createMemorianGateWiring({
    snapshotSession: () => ({ id: SESSION_ID, entries: [] }),
    collectCandidatesFromSnapshot: input.collect,
    resolveContext: (sessionId) => (sessionId === SESSION_ID ? input.identity : undefined),
    runnerFor: () => ({
      launch: input.launch ?? (async (launchInput) => {
        input.launches.push(launchInput)
        return { status: "empty" as const }
      }),
      ...(input.cancel === undefined ? {} : { cancel: input.cancel }),
      ...(input.whenIdle === undefined ? {} : { whenIdle: input.whenIdle }),
    }),
    ...(input.logs === undefined
      ? {}
      : {
          logger: {
            info: (message, details) => input.logs?.push({ message, details }),
            warn: (message, details) => input.logs?.push({ message, details }),
            error: (message, details) => input.logs?.push({ message, details }),
          },
        }),
  })
  if (input.entries !== undefined) wiring.attachEntrySink((customType, data) => input.entries?.push({ customType, data }))
  return wiring
}
