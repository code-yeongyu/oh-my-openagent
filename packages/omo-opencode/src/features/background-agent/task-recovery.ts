import { randomUUID } from "node:crypto"
import { z } from "zod"
import { dispatchInternalPrompt, releasePromptAsyncReservation } from "../../shared/prompt-async-gate"
import { isAmbiguousPostDispatchPromptFailure } from "../../shared/prompt-failure-classifier"
import { createPromptTimeoutContext, PROMPT_TIMEOUT_MS } from "../../shared/prompt-timeout-context"
import type { OpencodeClient } from "./constants"
import type { BackgroundTask } from "./types"
import { TaskRecoveryError, TaskRecoveryStore, type TaskRecoveryRecord } from "./task-recovery-store"
import { probeTaskOwner, TaskWorkerOwnership } from "./task-worker-ownership"

const RecoverableSessionSchema = z.object({
  id: z.string(), parentID: z.string().min(1), directory: z.string(), title: z.string().optional(),
  time: z.object({ archived: z.number().optional() }).optional(),
})
const HistorySchema = z.array(z.object({ info: z.object({
  role: z.string(), agent: z.string().optional(), providerID: z.string().optional(), modelID: z.string().optional(),
  variant: z.string().nullish(), model: z.object({ providerID: z.string(), modelID: z.string() }).optional(),
}) }))

export class TaskRecovery {
  private readonly store = new TaskRecoveryStore()
  private readonly generations = new Map<string, string>()
  private closed = false
  private readonly worker: TaskWorkerOwnership

  constructor(private readonly client: OpencodeClient, private readonly canDispatch: () => boolean) {
    this.worker = new TaskWorkerOwnership(async (sessionId, generation) => {
      if (!this.owns(sessionId, generation) || !this.generations.has(sessionId)) return "unknown"
      const response = await this.client.session.status()
      return response.error ? "unknown" : "owned"
    })
  }

  generation(sessionId: string): string | undefined { return this.generations.get(sessionId) }

  owns(sessionId: string | undefined, generation?: string): boolean {
    if (this.closed) return false
    if (!sessionId || !this.generations.has(sessionId)) return true
    const expected = generation ?? this.generations.get(sessionId)
    try {
      return this.store.read(sessionId)?.generation === expected && this.generations.get(sessionId) === expected
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return false
    }
  }

  async persist(task: BackgroundTask, tools: Record<string, boolean>, cwd: string): Promise<void> {
    const sessionId = task.sessionId
    if (!sessionId) throw new TaskRecoveryError(task.id, "missing child identity")
    await this.store.locked(sessionId, async () => {
      const previous = this.store.read(sessionId)
      if (previous && (!this.generations.has(sessionId) || !this.owns(sessionId))) {
        throw new TaskRecoveryError(sessionId, "child belongs to another owner")
      }
      if (this.closed) throw new TaskRecoveryError(sessionId, "owner shut down")
      const owner = await this.worker.open()
      const generation = randomUUID()
      const record: TaskRecoveryRecord = {
        version: 1, taskId: task.id, sessionId, parentSessionId: previous?.parentSessionId ?? task.parentSessionId,
        agent: task.agent, cwd, owner, generation, tools,
        model: task.model, category: task.category, teamRunId: task.teamRunId,
        concurrencyGroup: task.concurrencyGroup, sessionPermission: task.sessionPermission,
      }
      this.store.write(record)
      this.generations.set(sessionId, generation)
    })
  }

  async recover(sessionId: string): Promise<BackgroundTask> {
    return this.store.locked(sessionId, async () => {
      const record = this.store.read(sessionId)
      if (!record) throw new TaskRecoveryError(sessionId, "no provable native owner metadata (legacy or unrelated child)")
      if (await probeTaskOwner(record) !== "dead") throw new TaskRecoveryError(sessionId, "owner is live or its liveness is unknown")
      const response = await this.client.session.get({ path: { id: sessionId }, query: { directory: record.cwd } })
      const session = RecoverableSessionSchema.safeParse(response.data)
      if (response.error || !session.success || session.data.id !== sessionId || session.data.parentID !== record.parentSessionId
        || session.data.directory !== record.cwd || session.data.time?.archived !== undefined) {
        throw new TaskRecoveryError(sessionId, "child session is missing, archived, root, or mismatched")
      }
      const messages = await this.client.session.messages({ path: { id: sessionId }, query: { directory: record.cwd } })
      const history = HistorySchema.safeParse(messages.data)
      if (messages.error || !history.success) {
        const details = history.success ? "SDK error" : history.error.issues.map((issue) => `${issue.code}:${issue.path.join(".")}`).join(",")
        throw new TaskRecoveryError(sessionId, `child history unavailable (${details})`)
      }
      const last = history.data.findLast((message) => message.info.role === "user" || message.info.role === "assistant")?.info
      const model = record.model ?? last?.model ?? (last?.providerID && last.modelID
        ? { providerID: last.providerID, modelID: last.modelID, variant: last.variant ?? undefined } : undefined)
      if (this.closed) throw new TaskRecoveryError(sessionId, "recovering owner shut down")
      const owner = await this.worker.open()
      const generation = randomUUID()
      this.store.write({ ...record, model, owner, generation })
      this.generations.set(sessionId, generation)
      return {
        id: record.taskId, sessionId, parentSessionId: record.parentSessionId, parentMessageId: "",
        agent: record.agent, description: session.data.title ?? record.agent, prompt: "", status: "interrupt",
        model, cwd: record.cwd, category: record.category, teamRunId: record.teamRunId,
        concurrencyGroup: record.concurrencyGroup, sessionPermission: record.sessionPermission,
      }
    })
  }

  tools(sessionId: string): Record<string, boolean> | undefined {
    return this.generations.has(sessionId) ? this.store.read(sessionId)?.tools : undefined
  }

  async dispatch(input: Parameters<OpencodeClient["session"]["promptAsync"]>[0], generation: string | undefined): Promise<void> {
    const timeout = createPromptTimeoutContext({}, PROMPT_TIMEOUT_MS)
    try {
      const result = await dispatchInternalPrompt({
        mode: "async", client: this.client, sessionID: input.path.id, input: { ...input, signal: timeout.signal },
        source: "background-agent-launch", settleMs: 0, queueBehavior: "defer",
        shouldDispatch: () => this.canDispatch() && this.owns(input.path.id, generation),
      })
      if (timeout.wasTimedOut()) throw new TaskRecoveryError(input.path.id, `prompt timed out after ${PROMPT_TIMEOUT_MS}ms`)
      switch (result.status) {
        case "dispatched": case "queued": return
        case "failed":
          if (isAmbiguousPostDispatchPromptFailure(result)) return
          releasePromptAsyncReservation(input.path.id, "background-agent-launch")
          throw result.error
        case "active": case "reserved": case "cancelled": case "unavailable":
          throw new TaskRecoveryError(input.path.id, `prompt dispatch ${result.status}`)
        default: {
          const exhaustive: never = result
          throw exhaustive
        }
      }
    } finally {
      timeout.cleanup()
    }
  }

  close(): void { this.closed = true; this.worker.close() }
}
