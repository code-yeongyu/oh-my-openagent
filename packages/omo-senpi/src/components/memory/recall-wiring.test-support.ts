import { mkdtemp } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  GitMemoryRepo,
  buildIdentityPaths,
} from "@oh-my-opencode/memory-core"

import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"

export const IDENTITY = "recall-agent"
export const SESSION_ID = "session-recall-1"

export const ROLLOUTS_PATH = "reference/kubernetes-rollouts.md"
export const ROLLOUTS_DESCRIPTION = "How the team ships kubernetes rollouts"
export const ROLLOUTS_BODY =
  "Always drain kubernetes nodes before a rollout, then verify the deployment health endpoint.\n"
export const DRAINS_PATH = "notes/kubernetes-drains.md"
export const DRAINS_DESCRIPTION = "Kubernetes drain checklist"
export const DRAINS_BODY =
  "Drain kubernetes nodes and check the deployment health endpoint before any rollout.\n"
export const KUBERNETES_PROMPT = "how do we handle kubernetes rollouts here"

export interface Fixture {
  readonly repo: GitMemoryRepo
  readonly context: MemoryIdentityContext
}

export async function fixture(
  tempDirs: string[],
  extraSeedFiles: readonly { relativePath: string; content: string }[] = [],
): Promise<Fixture> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-recall-")))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir: join(dir, "repo"), agentId: IDENTITY })
  await repo.init({
    seedFiles: [
      {
        relativePath: "system/persona.md",
        content: "---\ndescription: Persona\n---\nsystem text\n",
      },
      {
        relativePath: ROLLOUTS_PATH,
        content: `---\ndescription: ${ROLLOUTS_DESCRIPTION}\n---\n${ROLLOUTS_BODY}`,
      },
      ...extraSeedFiles,
    ],
  })
  const context = createMemoryIdentityContext({
    identity: IDENTITY,
    identityPaths: buildIdentityPaths(join(dir, "memory"), IDENTITY),
    binding: createMemoryBinding({ identity: IDENTITY, repoPath: repo.dir, boundAt: 0 }),
  })
  return { repo, context }
}

export function beforeAgentStart(prompt = "hello"): unknown {
  return { type: "before_agent_start", prompt, systemPrompt: "SYSTEM" }
}

export type BranchEntry = Record<string, unknown>

export function userEntry(id: string, text: string): BranchEntry {
  return { type: "message", id, message: { role: "user", content: [{ type: "text", text }] } }
}

export function assistantEntry(id: string, text: string): BranchEntry {
  return { type: "message", id, message: { role: "assistant", content: [{ type: "text", text }] } }
}

export function customMessageEntry(id: string, customType: string, content: string): BranchEntry {
  return { type: "custom_message", id, customType, content, display: false }
}

export function eventContext(entries: readonly BranchEntry[], sessionId = SESSION_ID): unknown {
  return {
    sessionManager: {
      getSessionId: () => sessionId,
      getBranch: () => entries,
    },
  }
}
