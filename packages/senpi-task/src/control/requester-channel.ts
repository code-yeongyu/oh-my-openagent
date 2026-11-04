import type { RunRef } from "../pause/ports"
import type { TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import { ControlInbox } from "./control-inbox"
import { defaultControlFsEnv, listControlFiles, readControlFile, type ControlFsEnv } from "./control-fs"
import { advertisementName, ownersDir } from "./control-paths"
import { parseAdvertisement, type ControlAck, type ControlGuidance, type ControlPhase, type ControlRegister, type OwnerAdvertisement } from "./control-schema"
import { readAckFile, writeRegister, type ControlStore, type RegisterWrite } from "./control-store"

const ADVERTISEMENT_LIVE_MS = 15_000

// A requester-side answer that is never written in an ack (design 3.3 compatibility edges).
export type OwnerCannotApply = "owner_unsupported" | "handle_gone" | "channel_disabled"

export type RequesterChannelOptions = {
  readonly stateDir: string
  readonly store: TaskRecordStore
  readonly hostPid: number
  readonly managerInstance: string
  readonly channel: boolean
  readonly isProcessAlive: (pid: number) => boolean
  readonly now?: () => number
  readonly env?: ControlFsEnv
}

export type DesiredState = {
  readonly taskId: string
  readonly runEpoch: number
  readonly parentSessionId: string
  readonly pauseSeq: number
  readonly runRef: RunRef
  readonly phase: ControlPhase
  readonly resumeId?: string
  readonly cancel?: { readonly requestedAt: string; readonly reason?: string }
  readonly guidance?: readonly ControlGuidance[]
}

export type RequesterChannel = ReturnType<typeof createRequesterChannel>

// The requester half of the store-mediated channel (design 3.2): who owns a record, whether that
// owner reads registers, writing the desired state, and accepting only the ack that answers it.
export function createRequesterChannel(options: RequesterChannelOptions) {
  const control: ControlStore = { stateDir: options.stateDir, env: options.env ?? defaultControlFsEnv() }
  const now = options.now ?? Date.now

  // 3.2 ownership predicate: another live process, or a sibling manager of this process that holds
  // the live handle (answered from the in-memory inbox registry, never from a file).
  function ownedElsewhere(record: TaskRecord): boolean {
    const owner = record.host_pid
    if (owner === undefined) return false
    if (owner !== options.hostPid) return options.isProcessAlive(owner)
    return ControlInbox.heldBySibling(options.stateDir, options.hostPid, record.task_id, options.managerInstance)
  }

  function live(advertisement: OwnerAdvertisement | undefined): boolean {
    if (advertisement === undefined) return false
    const renewed = Date.parse(advertisement.renewedAt)
    return Number.isFinite(renewed) && now() - renewed <= ADVERTISEMENT_LIVE_MS && options.isProcessAlive(advertisement.pid)
  }

  function advertised(record: TaskRecord): boolean {
    const pid = record.host_pid
    if (pid === undefined) return false
    const dir = ownersDir(options.stateDir)
    const names = record.host_manager_instance !== undefined ? [advertisementName(pid, record.host_manager_instance)]
      : listControlFiles(dir, control.env).map(file => file.name).filter(name => name.startsWith(`${pid}-`))
    return names.some(name => {
      const read = readControlFile(dir, name, control.env)
      const advertisement = read.kind === "ok" ? parseAdvertisement(read.text) : undefined
      return advertisement?.pid === pid && live(advertisement)
    })
  }

  function cannotApply(record: TaskRecord): OwnerCannotApply | undefined {
    if (!options.channel) return "channel_disabled"
    return advertised(record) ? undefined : "owner_unsupported"
  }

  const requester = { pid: options.hostPid, managerInstance: options.managerInstance }

  function register(desired: DesiredState): ControlRegister {
    return {
      version: 1, ...desired,
      ...(desired.guidance === undefined || desired.guidance.length === 0 ? {} : { guidance: desired.guidance }),
      requester, writtenAt: new Date(now()).toISOString(),
    }
  }

  function assertDesired(desired: DesiredState): RegisterWrite {
    return writeRegister(options.store, control, register(desired))
  }

  // An ack answers the current desired state only (design 3.1): same task, epoch, parent, seq and
  // phase, and the same resumeId for a Resume. A cancelled/settled ack on a flagged record always counts.
  function acceptedAck(desired: DesiredState, flagged: boolean): ControlAck | undefined {
    const ack = readAckFile(control, desired.taskId, desired.parentSessionId)
    if (ack === undefined || ack.taskId !== desired.taskId || ack.parentSessionId !== desired.parentSessionId) return undefined
    if (flagged && (ack.state === "cancelled" || ack.state === "settled")) return ack
    if (ack.runEpoch !== desired.runEpoch || ack.phase !== desired.phase) return undefined
    if (desired.phase !== "cancelled" && ack.pauseSeq !== desired.pauseSeq) return undefined
    if (desired.phase === "resumed" && ack.resumeId !== desired.resumeId) return undefined
    return ack
  }

  function lastAck(taskId: string, parentSessionId: string): ControlAck | undefined {
    return readAckFile(control, taskId, parentSessionId)
  }

  // The model-facing line for a child another live process runs (design section 5 "Model-facing surface").
  function ownerStatus(record: TaskRecord): string | undefined {
    if (!ownedElsewhere(record)) return undefined
    const pid = record.host_pid ?? 0
    const last = lastAck(record.task_id, record.parent_session_id)
    const reason = last?.state === "refused" && last.reason === "handle_gone" ? "handle_gone" : cannotApply(record)
    if (reason !== undefined) return `owner cannot apply: ${reason} (pid ${pid})`
    return `running in another omo process (pid ${pid}); this run's Stop/Resume is carried there; its completion is reported to that process's session`
  }

  return { ownedElsewhere, ownerStatus, cannotApply, assertDesired, acceptedAck, lastAck, channel: options.channel, control, requester }
}
