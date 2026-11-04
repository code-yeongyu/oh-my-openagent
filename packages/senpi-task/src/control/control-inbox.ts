import { watch, type FSWatcher } from "node:fs"
import { log } from "@oh-my-opencode/utils"
import type { TaskRecordStore } from "../store"
import { defaultControlFsEnv, listControlFiles, removeControlFile, type ControlFsEnv } from "./control-fs"
import { controlDir } from "./control-paths"
import type { ControlStore } from "./control-store"
import { createDispatchState, dispatchRegister, dispatchTransactionChild, MAX_FILES_PER_TICK, validRegister, type DispatchContext, type ValidRegister } from "./inbox-dispatch"
import { ADVERTISEMENT_RENEW_MS, readProcessStartTime, renewAdvertisement, sweepAdvertisements, withdrawAdvertisement } from "./owner-advertisement"
import type { ControlOwnerPort } from "./owner-port"

const POLL_MS = 1_000
const SWEEP_MS = 60_000
const DAY_MS = 24 * 60 * 60 * 1000
const TERMINAL = new Set(["completed", "error", "cancelled", "interrupted", "lost"])

type Member = { readonly port: ControlOwnerPort; readonly channel: boolean; liveTasks: () => number; renewedAt?: number }

export type ControlInboxOptions = {
  readonly stateDir: string
  readonly hostPid: number
  readonly store: TaskRecordStore
  readonly env?: ControlFsEnv
  readonly now?: () => number
  // Test seam: the inbox ticks only when driven; production arms the doorbell and the 1 s poll.
  readonly autoStart?: boolean
}

const inboxes = new Map<string, ControlInbox>()

// One inbox per (process, store); its member list is also the exact in-memory answer to "does
// another manager of this process hold this task" (design 3.2 case b), with the channel on or off.
export class ControlInbox {
  readonly #members = new Set<Member>()
  readonly #control: ControlStore
  readonly #state = createDispatchState()
  readonly #now: () => number
  #ticking: Promise<void> | undefined
  #watcher: FSWatcher | undefined
  #poll: ReturnType<typeof setInterval> | undefined
  #sweptAt = 0

  private constructor(readonly options: ControlInboxOptions) {
    this.#control = { stateDir: options.stateDir, env: options.env ?? defaultControlFsEnv() }
    this.#now = options.now ?? Date.now
  }

  static for(options: ControlInboxOptions): ControlInbox {
    const key = `${options.hostPid}\0${options.stateDir}`
    let inbox = inboxes.get(key)
    if (inbox === undefined) { inbox = new ControlInbox(options); inboxes.set(key, inbox) }
    return inbox
  }

  static heldBySibling(stateDir: string, hostPid: number, taskId: string, self: string): boolean {
    const inbox = inboxes.get(`${hostPid}\0${stateDir}`)
    return inbox !== undefined && [...inbox.#members].some(member => member.port.managerInstance !== self && member.port.holds(taskId))
  }

  register(port: ControlOwnerPort, input: { readonly channel: boolean; readonly liveTasks: () => number }): () => Promise<void> {
    const member: Member = { port, channel: input.channel, liveTasks: input.liveTasks }
    this.#members.add(member)
    if (member.channel && this.options.autoStart !== false) this.#start()
    return async () => {
      this.#members.delete(member)
      await this.#ticking
      if (member.channel) withdrawAdvertisement(this.#control, this.options.hostPid, port.managerInstance)
      if (![...this.#members].some(entry => entry.channel)) this.#stop()
      if (this.#members.size === 0) inboxes.delete(`${this.options.hostPid}\0${this.options.stateDir}`)
    }
  }

  tick(): Promise<void> {
    if (this.#ticking !== undefined) return this.#ticking
    const ticking = this.#run().catch((error: unknown) => {
      log("[senpi-task] control inbox tick failed", { error: error instanceof Error ? error.message : String(error) })
    }).finally(() => { this.#ticking = undefined })
    this.#ticking = ticking
    return ticking
  }

  #channelMembers(): readonly Member[] {
    return [...this.#members].filter(member => member.channel)
  }

  async #run(): Promise<void> {
    const members = this.#channelMembers()
    if (members.length === 0) return
    const now = this.#now()
    this.#renew(members, now)
    const context: DispatchContext = {
      control: this.#control, store: this.options.store, state: this.#state, now, hostPid: this.options.hostPid,
      owner: { pid: this.options.hostPid, managerInstance: members[0]?.port.managerInstance ?? "",
        ...(startTime(this.options.hostPid) === undefined ? {} : { processStartTime: startTime(this.options.hostPid) }) },
      holder: taskId => members.find(member => member.port.holds(taskId))?.port,
    }
    const files = listControlFiles(controlDir(this.options.stateDir), this.#control.env).filter(file => file.name.startsWith("want-"))
    const registers = files.slice(0, MAX_FILES_PER_TICK).flatMap(file => validRegister(context, file.name) ?? [])
    for (const entry of registers) {
      const holder = context.holder(entry.register.taskId)
      const scoped = holder === undefined ? context : { ...context, owner: { ...context.owner, managerInstance: holder.managerInstance } }
      const result = await dispatchRegister(scoped, entry)
      if (result.kind === "release_own_stop" && holder !== undefined) {
        await this.#releaseOwnStop(scoped, holder, entry, result.root, result.ownSeq, registers)
      }
    }
    if (now - this.#sweptAt >= SWEEP_MS) { this.#sweptAt = now; this.#sweep(now) }
  }

  #renew(members: readonly Member[], now: number): void {
    for (const member of members) {
      const sessionId = member.port.sessionId()
      if (member.liveTasks() === 0 || sessionId === undefined) continue
      if (member.renewedAt !== undefined && now - member.renewedAt < ADVERTISEMENT_RENEW_MS) continue
      if (renewAdvertisement(this.#control, { pid: this.options.hostPid, managerInstance: member.port.managerInstance, sessionId, now,
        processStartTime: startTime(this.options.hostPid) })) member.renewedAt = now
    }
  }

  // The register releases the owner's own Stop (design 3.3 barrier rule): resume the children whose
  // registers were collected with the run's credential, then the held admissions, and always reopen.
  async #releaseOwnStop(context: DispatchContext, port: ControlOwnerPort, trigger: ValidRegister, root: string, ownSeq: number,
    registers: readonly ValidRegister[]): Promise<void> {
    const barrier = port.barrier
    const resumeId = trigger.register.resumeId
    if (barrier === undefined || resumeId === undefined) return
    const credential = barrier.resume(root, ownSeq, resumeId)
    try {
      const collected = registers.filter(entry => entry.register.parentSessionId === root && entry.register.phase === "resumed"
        && entry.register.resumeId === resumeId)
      for (const entry of collected) await dispatchTransactionChild(context, entry, credential)
      await port.releaseRemoteStop?.({ parentSessionId: root, pauseSeq: ownSeq, resumeId, credential })
    } finally {
      barrier.release(root, credential)
    }
  }

  #sweep(now: number): void {
    const dir = controlDir(this.options.stateDir)
    for (const file of listControlFiles(dir, this.#control.env)) {
      if (now - file.mtimeMs <= DAY_MS) continue
      const taskId = /^(?:want|ack)-(.+)-[0-9a-f]{16}\.json$/.exec(file.name)?.[1]
      if (taskId === undefined) continue
      const record = this.options.store.load(taskId)
      if (record === null || record === undefined || TERMINAL.has(record.status)) removeControlFile(dir, file.name)
    }
    sweepAdvertisements(this.#control, now)
  }

  #start(): void {
    if (this.#poll !== undefined) return
    this.#poll = setInterval(() => { void this.tick() }, POLL_MS)
    this.#poll.unref?.()
    try {
      this.#watcher = watch(controlDir(this.options.stateDir), () => { void this.tick() })
      this.#watcher.on("error", () => { this.#watcher?.close(); this.#watcher = undefined })
      this.#watcher.unref?.()
    } catch {
      this.#watcher = undefined
    }
  }

  #stop(): void {
    if (this.#poll !== undefined) clearInterval(this.#poll)
    this.#poll = undefined
    this.#watcher?.close()
    this.#watcher = undefined
  }
}

const startTime = (pid: number): number | undefined => readProcessStartTime(pid)
