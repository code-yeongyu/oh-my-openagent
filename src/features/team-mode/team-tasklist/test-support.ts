import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { getTasksDir, resolveBaseDir } from "../team-registry"
import type { Task } from "../types"

export async function createTasklistFixture(): Promise<{
  config: TeamModeConfig
  rootDirectory: string
  teamRunId: string
  cleanup: () => Promise<void>
}> {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), "team-tasklist-"))
  const config = TeamModeConfigSchema.parse({ base_dir: rootDirectory, enabled: true })
  const teamRunId = randomUUID()
  const tasksDirectory = getTasksDir(resolveBaseDir(config), teamRunId)

  await mkdir(path.join(tasksDirectory, "claims"), { recursive: true, mode: 0o700 })

  return {
    config,
    rootDirectory,
    teamRunId,
    cleanup: async () => {
      await rm(rootDirectory, { recursive: true, force: true })
    },
  }
}

export function createTaskInput(overrides?: Partial<Omit<Task, "id" | "createdAt" | "updatedAt" | "version">>): Omit<Task, "id" | "createdAt" | "updatedAt" | "version"> {
  return {
    subject: overrides?.subject ?? "task subject",
    description: overrides?.description ?? "task description",
    activeForm: overrides?.activeForm,
    status: overrides?.status ?? "pending",
    owner: overrides?.owner,
    blocks: overrides?.blocks ?? [],
    blockedBy: overrides?.blockedBy ?? [],
    metadata: overrides?.metadata,
    claimedAt: overrides?.claimedAt,
  }
}
