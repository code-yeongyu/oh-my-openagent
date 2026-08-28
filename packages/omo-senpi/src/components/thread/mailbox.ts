import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { writeFileAtomically } from "@oh-my-opencode/utils/atomic-write"

import { threadToolFailure, type ThreadErrorCode } from "./errors"

export const MAILBOX_MAX_MESSAGES = 128
export const MAILBOX_MAX_BYTES = 1024 * 1024

type DeliveryMode = "auto" | "steer" | "follow_up"

export type MailboxTurnSnapshot = {
  readonly active: boolean
  readonly turn_id?: string
}

export type MailboxTargetPort = {
  readonly snapshot: () => Promise<MailboxTurnSnapshot>
  readonly steer: (message: string, expectedTurnId: string, operationId: string, streamingBehavior?: "steer") => Promise<void>
  readonly start: (message: string, operationId: string, streamingBehavior?: "followUp") => Promise<{ readonly turn_id: string }>
}

export type MailboxItem = {
  readonly target: string
  readonly message: string
  readonly message_seq: number
  readonly delivery: DeliveryMode
  readonly expected_turn_id?: string
  readonly operation_id: string
  readonly accepted_at: string
}

export type MailboxSuccess =
  | { readonly kind: "ok"; readonly message_seq: number; readonly delivery: "steered"; readonly turn_id: string }
  | { readonly kind: "ok"; readonly message_seq: number; readonly delivery: "started"; readonly turn_id: string }
  | { readonly kind: "ok"; readonly message_seq: number; readonly delivery: "queued"; readonly queue_position: number }
export type MailboxResult = MailboxSuccess | { readonly kind: "error"; readonly error: ReturnType<typeof threadToolFailure> }

type StoredState = { readonly next_seq: number; readonly queues: Readonly<Record<string, readonly MailboxItem[]>> }

export type OrderedDeliveryMailbox = {
  readonly accept: (target: string, message: string, options?: { readonly delivery?: DeliveryMode; readonly expected_turn_id?: string }) => Promise<MailboxResult>
  /** Call after a target becomes idle; pending follow_up/auto messages are then dispatched. */
  readonly notify: (target: string) => Promise<void>
  readonly pending: (target: string) => readonly MailboxItem[]
  readonly close: () => void
}

export type MailboxOptions = {
  readonly directory: string
  readonly portFor: (target: string) => MailboxTargetPort | undefined
  readonly now?: () => number
  readonly max_messages?: number
  readonly max_bytes?: number
}

export function createOrderedDeliveryMailbox(options: MailboxOptions): OrderedDeliveryMailbox {
  mkdirSync(options.directory, { recursive: true, mode: 0o700 })
  const statePath = join(options.directory, "mailbox.json")
  let state = readState(statePath)
  const workers = new Map<string, Promise<void>>()
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const waiters = new Map<number, (result: MailboxResult) => void>()
  let closed = false
  const now = options.now ?? Date.now
  const maxMessages = options.max_messages ?? MAILBOX_MAX_MESSAGES
  const maxBytes = options.max_bytes ?? MAILBOX_MAX_BYTES

  function persist(): void {
    writeFileAtomically(statePath, JSON.stringify(state))
  }

  function queueFor(target: string): MailboxItem[] {
    return [...(state.queues[target] ?? [])]
  }

  function replaceQueue(target: string, queue: readonly MailboxItem[]): void {
    const queues = { ...state.queues }
    if (queue.length === 0) delete queues[target]
    else queues[target] = queue
    state = { ...state, queues }
    persist()
  }

  function removeItem(target: string, messageSeq: number): void {
    replaceQueue(target, queueFor(target).filter((item) => item.message_seq !== messageSeq))
  }

  // Bounded-cadence retry: one 50ms timer per target (deduped), cleared by close(). Attempts
  // are UNBOUNDED BY DESIGN: every path that arms this timer holds a message that must not be
  // dropped - retryable host pushback ("already processing") clears when the host turn settles,
  // and a follow_up head behind an active turn clears at the idle transition. Liveness is
  // covered twice: notify() dispatches immediately on an observed idle transition, and this
  // armed timer is the idle-trigger fallback that discovers the transition on its own, so an
  // accept() caller can never be left waiting on a settle that nothing will produce. Capping
  // attempts instead would have to classify a live-but-busy host as terminal, stranding a
  // durably retained message whose only delivery path is this loop. Messages stay on disk
  // across every attempt and are removed only on a terminal settle.
  function retryLater(target: string): void {
    if (closed || retryTimers.has(target)) return
    retryTimers.set(target, setTimeout(() => {
      retryTimers.delete(target)
      void run(target)
    }, 50))
  }

  async function pump(target: string): Promise<void> {
    while (!closed) {
      const queue = queueFor(target)
      if (queue.length === 0) return
      const item = queue[0]
      const port = options.portFor(target)
      if (port === undefined) {
        settle(item, error("not_resumable", `Thread ${target} has no live owner.`, "Retry when the target is live, or use thread_list to choose a live thread."))
        removeItem(target, item.message_seq)
        continue
      }
      let snapshot: MailboxTurnSnapshot
      try {
        snapshot = await port.snapshot()
      } catch {
        // A rejected snapshot read is an exceptional port/RPC failure, not a terminal verdict
        // on the message: treat it as transient-busy, keep the head durably on disk, and arm
        // the liveness floor. Without this guard pump() would exit via unhandled rejection
        // with no settle and no timer, wedging an accept() caller forever (verified repro:
        // HUNG at 5016ms/5005ms with the rejection stack pointing at this line) - the same
        // settle-or-arm invariant as the busy-turn return below.
        retryLater(target)
        return
      }
      if (item.delivery === "follow_up" && snapshot.active) {
        // Invariant: pump() must never leave accepted work unsettled with no armed mechanism.
        // The head is behind an active turn, so it cannot be delivered right now; arming the
        // bounded retry timer guarantees a later dispatch even if the turn settles between
        // this read (ACTIVE) and accept()'s own snapshot read (INACTIVE) - the TOCTOU that
        // otherwise wedged accept() forever with the message durably stuck on disk (verified
        // repro: verify-fix2-harness/p2-race.ts, HUNG at 10003ms/10020ms). notify() stays the
        // fast path; this timer is the liveness floor.
        retryLater(target)
        return
      }
      if (item.delivery === "steer" && !snapshot.active) {
        settle(item, error("no_active_turn", `Thread ${target} has no active turn to steer.`, "Use delivery auto or follow_up, or retry while the target turn is active."))
        removeItem(target, item.message_seq)
        continue
      }
      if (item.delivery === "steer" && item.expected_turn_id === undefined) {
        settle(item, error("invalid_arguments", "Steer delivery needs expected_turn_id.", "Read the active turn id and retry with expected_turn_id."))
        removeItem(target, item.message_seq)
        continue
      }
      if (item.delivery === "steer" || (item.delivery === "auto" && snapshot.active)) {
        const expected = item.expected_turn_id ?? snapshot.turn_id
        if (expected === undefined || snapshot.turn_id !== expected) {
          settle(item, error("turn_conflict", `The active turn for ${target} changed before delivery.`, "Read the target again and retry with the current turn id."))
          removeItem(target, item.message_seq)
          continue
        }
        try {
          await port.steer(item.message, expected, item.operation_id, "steer")
          settle(item, { kind: "ok", message_seq: item.message_seq, delivery: "steered", turn_id: expected })
          removeItem(target, item.message_seq)
        } catch (failure) {
          if (isRetryableHostPushback(failure)) {
            settle(item, queued(item, queue.length))
            retryLater(target)
            return
          }
          settle(item, error("turn_conflict", `The active turn for ${target} changed before delivery.`, "Read the target again and retry with the current turn id."))
          removeItem(target, item.message_seq)
        }
      } else {
        try {
          const started = await port.start(item.message, item.operation_id, "followUp")
          settle(item, { kind: "ok", message_seq: item.message_seq, delivery: "started", turn_id: started.turn_id })
          removeItem(target, item.message_seq)
        } catch (failure) {
          if (isRetryableHostPushback(failure)) {
            settle(item, queued(item, queue.length))
            retryLater(target)
            return
          }
          settle(item, error("internal_error", `Delivery to ${target} could not start a turn.`, "Retry the message after checking the target status."))
          removeItem(target, item.message_seq)
        }
      }
    }
  }

  function settle(item: MailboxItem, result: MailboxResult): void {
    waiters.get(item.message_seq)?.(result)
    waiters.delete(item.message_seq)
  }

  function run(target: string): Promise<void> {
    const existing = workers.get(target)
    if (existing !== undefined) return existing
    const worker = pump(target).finally(() => workers.delete(target))
    workers.set(target, worker)
    return worker
  }

  async function accept(target: string, message: string, request: { readonly delivery?: DeliveryMode; readonly expected_turn_id?: string } = {}): Promise<MailboxResult> {
    if (closed) return error("transport_closed", "The mailbox is closed.", "Retry through a live thread tool session.")
    const delivery = request.delivery ?? "auto"
    if (delivery === "steer" && request.expected_turn_id === undefined) return error("invalid_arguments", "Steer delivery needs expected_turn_id.", "Read the active turn id and retry with expected_turn_id.")
    const queue = queueFor(target)
    const messageBytes = Buffer.byteLength(message)
    if (messageBytes > maxBytes) return error("message_too_large", `The message is ${messageBytes} bytes, above the ${maxBytes}-byte mailbox limit.`, "Shorten the message below the mailbox limit and retry.")
    const bytes = queue.reduce((total, item) => total + Buffer.byteLength(item.message), 0) + messageBytes
    if (queue.length >= maxMessages || bytes > maxBytes) return error("queue_full", `The delivery queue for ${target} is full.`, "Wait for queued messages to drain, then retry.")
    const item: MailboxItem = {
      target, message, message_seq: state.next_seq, delivery,
      ...(request.expected_turn_id === undefined ? {} : { expected_turn_id: request.expected_turn_id }),
      operation_id: `${target}-${state.next_seq}`,
      accepted_at: new Date(now()).toISOString(),
    }
    state = { next_seq: state.next_seq + 1, queues: { ...state.queues, [target]: [...queue, item] } }
    persist()
    const result = new Promise<MailboxResult>((resolve) => waiters.set(item.message_seq, resolve))
    void run(target)
    const snapshot = await options.portFor(target)?.snapshot()
    const head = queueFor(target)[0]
    if (snapshot?.active && head?.delivery === "follow_up") return queued(item, queueFor(target).findIndex((entry) => entry.message_seq === item.message_seq) + 1)
    return result
  }

  return {
    accept,
    notify: async (target) => { await run(target) },
    pending: (target) => queueFor(target),
    close: () => {
      closed = true
      for (const timer of retryTimers.values()) clearTimeout(timer)
      retryTimers.clear()
    },
  }
}

function readState(path: string): StoredState {
  if (!existsSync(path)) return { next_seq: 1, queues: {} }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<StoredState>
  return { next_seq: typeof parsed.next_seq === "number" ? parsed.next_seq : 1, queues: parsed.queues ?? {} }
}

function queued(item: MailboxItem, queuePosition: number): MailboxSuccess {
  return { kind: "ok", message_seq: item.message_seq, delivery: "queued", queue_position: queuePosition }
}

function isRetryableHostPushback(failure: unknown): boolean {
  const text = failure instanceof Error ? failure.message : String(failure)
  return text.includes("Agent is already processing") || text.includes("streamingBehavior")
}

function error(code: ThreadErrorCode, message: string, nextAction: string): MailboxResult {
  return { kind: "error", error: threadToolFailure(code, message, nextAction) }
}
