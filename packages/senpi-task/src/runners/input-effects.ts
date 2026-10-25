import { log } from "@oh-my-opencode/utils"
import type { TaskRecordStore } from "../store"
import { RpcRequestTimeout } from "./rpc/errors"

export type InputCommand = {
  readonly type: "prompt" | "steer" | "follow_up"
  readonly message: string
  readonly streamingBehavior?: "steer" | "followUp"
}
export type IdentifiedInput = InputCommand & { readonly clientMessageId: string }

export class InputUncertainError extends Error {
  constructor(readonly effectId: string, override readonly cause: Error) {
    super(`uncertain: ${unacknowledgedReason(cause)}; it may still be delivered. omo will confirm by itself; do not resend the same text.`, { cause })
  }
}

function unacknowledgedReason(cause: Error): string {
  if (cause instanceof RpcRequestTimeout) return `the host did not acknowledge this message within ${Math.round(cause.deadlineMs / 1000)} s`
  if (cause.name === "RpcTransportGoneError") return "the connection to the host was lost before it acknowledged this message"
  return "the host did not acknowledge this message before its request deadline"
}

export class InputConflictError extends Error {
  readonly reason = "effect_id_conflict"
  readonly detail = "this message id is already bound to a different message on the host"
  readonly action = "send the message again"
  constructor(readonly effectId: string) {
    super("this message id is already bound to a different message on the host; send the message again")
  }
}

export type InputEffects = ReturnType<typeof createInputEffects>

/** Both RPC runners use this boundary; a retry never changes the semantic input or its identity. */
export function createInputEffects(input: {
  readonly taskId: string
  readonly store?: TaskRecordStore
  readonly send: (command: IdentifiedInput) => Promise<void>
}) {
  let localSeq = 0
  const pending = new Map<string, IdentifiedInput>()
  const retries = new Map<string, Promise<void>>()
  const scheduled = new Set<ReturnType<typeof setImmediate>>()
  let retrying = true
  const { store, taskId } = input

  const remember = (command: IdentifiedInput): void => {
    pending.set(command.clientMessageId, command)
    store?.mutate(taskId, record => ({
      ...record,
      uncertain_inputs: [...(record.uncertain_inputs ?? []).filter(item => item.clientMessageId !== command.clientMessageId), command],
    }))
  }
  const forget = (command: IdentifiedInput): void => {
    pending.delete(command.clientMessageId)
    store?.mutate(taskId, record => {
      const remaining = record.uncertain_inputs?.filter(item => item.clientMessageId !== command.clientMessageId)
      const { uncertain_inputs: _uncertain, ...rest } = record
      return remaining === undefined || remaining.length === 0 ? rest : { ...rest, uncertain_inputs: remaining }
    })
  }
  const event = (type: string, command: IdentifiedInput, extra: Record<string, unknown> = {}): void => {
    store?.appendEvent(taskId, { type, payload: {
      effect_id: command.clientMessageId,
      run_epoch: epochOf(command),
      ...extra,
    } })
  }
  const retry = (command: IdentifiedInput): Promise<void> => {
    if (!retrying) return Promise.resolve()
    const active = retries.get(command.clientMessageId)
    if (active !== undefined) return active
    const work = (async () => {
      try {
        await input.send(command)
        if (!retrying) return
        forget(command)
        event(command.type === "prompt" && command.streamingBehavior === undefined ? "started" : "steered", command,
          { delivered: command.type === "steer" || command.streamingBehavior === "steer" ? "steer" : "followUp" })
      } catch (error) {
        if (!retrying) return
        if (isUnacknowledged(error)) return
        forget(command)
        const conflict = isConflict(error) ? new InputConflictError(command.clientMessageId) : undefined
        event("effect_failed", command, conflict === undefined
          ? { reason: "input_refused", detail: String(error), action: "inspect task_output before sending another message" }
          : { reason: conflict.reason, detail: conflict.detail, action: conflict.action })
      }
    })().finally(() => { retries.delete(command.clientMessageId) })
    retries.set(command.clientMessageId, work)
    return work
  }

  return {
    async send(command: InputCommand, write = input.send): Promise<void> {
      let id = `${taskId}:0:${++localSeq}`
      store?.mutate(taskId, record => {
        const seq = Math.max(record.effect_seq ?? 0, record.host_session?.effect_seq ?? 0) + 1
        id = `${taskId}:${record.notification.run_epoch}:${seq}`
        return { ...record, effect_seq: seq, last_effect_id: id,
          ...(record.host_session === undefined ? {} : { host_session: { ...record.host_session, effect_seq: seq } }) }
      })
      const identified = { ...command, clientMessageId: id }
      try {
        await write(identified)
      } catch (error) {
        if (isConflict(error)) throw new InputConflictError(id)
        if (!isUnacknowledged(error)) throw error
        remember(identified)
        event("effect_uncertain", identified)
        // Yield to the caller's uncertain result before the one automatic retry is issued.
        if (retrying) {
          const immediate = setImmediate(() => {
            scheduled.delete(immediate)
            void retry(identified).catch(error => log("senpi-task input resolution failed", { taskId, error: String(error) }))
          })
          scheduled.add(immediate)
        }
        throw new InputUncertainError(id, error)
      }
    },
    async reconcile(): Promise<void> {
      const record = store?.load(taskId)
      const commands = record?.uncertain_inputs ?? [...pending.values()]
      const currentEpoch = record?.notification.run_epoch
      // An id whose retry is already in flight is settled by that retry, so the log never records it both ways.
      const stale = currentEpoch === undefined ? [] : commands.filter(command =>
        epochOf(command) !== currentEpoch && !retries.has(command.clientMessageId))
      for (const command of stale) {
        forget(command)
        event("effect_failed", command, {
          reason: "superseded_by_new_run",
          detail: "this message was never confirmed before its run ended, so it is not delivered into a later run",
          action: "send the message again if the task still needs it",
        })
      }
      await Promise.all(commands.filter(command => !stale.includes(command)).map(retry))
    },
    stopRetrying(): void {
      retrying = false
      for (const immediate of scheduled) clearImmediate(immediate)
      scheduled.clear()
    },
  }
}

function epochOf(command: IdentifiedInput): number {
  return Number(command.clientMessageId.split(":").at(-2))
}

function isConflict(error: unknown): boolean {
  return error instanceof Error && (("code" in error && error.code === "client_message_id_conflict")
    || error.message.includes("client_message_id_conflict"))
}

function isUnacknowledged(error: unknown): error is Error {
  return error instanceof RpcRequestTimeout || error instanceof Error
    && (error.message.startsWith("Timeout waiting for response to ")
      || error.name === "RpcTransportGoneError")
}
