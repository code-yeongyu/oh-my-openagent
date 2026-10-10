import { createHash, randomUUID } from "node:crypto"
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { getDataDir } from "../../shared/data-path"

export const TaskOwnerSchema = z.object({
  id: z.string().uuid(),
  hostname: z.string().min(1),
  port: z.number().int().min(1).max(65535),
}).strict()

export const TaskRecoverySchema = z.object({
  version: z.literal(1),
  sessionId: z.string().min(1),
  taskId: z.string().min(1),
  parentSessionId: z.string().min(1),
  agent: z.string().min(1),
  cwd: z.string().min(1),
  generation: z.string().uuid(),
  owner: TaskOwnerSchema,
  category: z.string().optional(),
  teamRunId: z.string().optional(),
  concurrencyGroup: z.string().optional(),
  tools: z.record(z.string(), z.boolean()),
  model: z.object({
    providerID: z.string(), modelID: z.string(), variant: z.string().optional(),
    reasoning: z.string().optional(), reasoningEffort: z.string().optional(),
    temperature: z.number().optional(), top_p: z.number().optional(), maxTokens: z.number().optional(),
    thinking: z.object({ type: z.enum(["enabled", "disabled"]), budgetTokens: z.number().optional() }).optional(),
    tools: z.record(z.string(), z.boolean()).optional(),
  }).strict().optional(),
  sessionPermission: z.array(z.object({ permission: z.string(), action: z.enum(["allow", "deny"]), pattern: z.string() })).optional(),
}).strict()

export type TaskRecoveryRecord = z.infer<typeof TaskRecoverySchema>
export type TaskOwner = z.infer<typeof TaskOwnerSchema>

export class TaskRecoveryError extends Error {
  constructor(readonly sessionId: string, readonly reason: string) {
    super(`Cannot recover task for session ${sessionId}: ${reason}`)
    this.name = "TaskRecoveryError"
  }
}

export class TaskRecoveryStore {
  private readonly root = join(getDataDir(), "omo", "background-owners")

  private path(sessionId: string): string {
    return join(this.root, `${createHash("sha256").update(sessionId).digest("hex")}.json`)
  }

  read(sessionId: string): TaskRecoveryRecord | undefined {
    try {
      const record = TaskRecoverySchema.parse(JSON.parse(readFileSync(this.path(sessionId), "utf8")))
      if (record.sessionId !== sessionId) throw new TaskRecoveryError(sessionId, "metadata identity mismatch")
      return record
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
      throw error
    }
  }

  write(record: TaskRecoveryRecord): void {
    const path = this.path(record.sessionId)
    const temporary = `${path}.${randomUUID()}`
    try {
      writeFileSync(temporary, JSON.stringify(TaskRecoverySchema.parse(record)), { mode: 0o600, flag: "wx" })
      renameSync(temporary, path)
    } catch (error) {
      try { unlinkSync(temporary) } catch (cleanupError) {
        if (!(cleanupError instanceof Error && "code" in cleanupError && cleanupError.code === "ENOENT")) throw cleanupError
      }
      throw error
    }
  }

  async locked<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    const lock = `${this.path(sessionId)}.lock`
    let descriptor: number
    try {
      descriptor = openSync(lock, "wx", 0o600)
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        throw new TaskRecoveryError(sessionId, "ownership decision already in progress or abandoned")
      }
      throw error
    }
    try { return await operation() } finally {
      closeSync(descriptor)
      unlinkSync(lock)
    }
  }
}
