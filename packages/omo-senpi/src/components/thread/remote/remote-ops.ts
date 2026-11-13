import { threadToolFailure, type ThreadToolFailure } from "../errors"
import type { CommandResult } from "@oh-my-opencode/device-service-core"
import { outcomeFailure, READ_UNCERTAIN } from "./outcome"
import type { AliasError, AliasHolder, JsonObject, RemoteSessionRow, RemoteThreadSurface } from "./ports"

type Failure = { readonly kind: "error"; readonly error: ThreadToolFailure }
const fail = (
  code: ThreadToolFailure["code"],
  message: string,
  next: string,
  details?: Readonly<Record<string, unknown>>,
): Failure => ({ kind: "error", error: threadToolFailure(code, message, next, details) })

/** A5: the relay is paid only; on any other plan the remote path answers this, never a silent failure or a queue. */
export async function remoteAvailable(remote: RemoteThreadSurface): Promise<Failure | undefined> {
  let state: string
  try {
    state = (await remote.sessions.status()).state
  } catch (error) {
    return fail(
      "host_unavailable",
      "This device's device service is not reachable.",
      "Install or start the device service, then retry.",
      { reason: error instanceof Error ? error.message : String(error) },
    )
  }
  if (state === "plan_required")
    return fail(
      "relay_requires_paid_plan",
      "Reaching sessions on other devices needs a paid plan; this account's plan has no relay.",
      "Upgrade the plan to use other devices, or work with threads on this device.",
    )
  if (state !== "connected")
    return fail(
      "host_unavailable",
      `Other devices are not reachable from this device right now (${state}).`,
      "Sign in, turn remote sessions on, or wait for the device service to connect, then retry.",
      { state },
    )
  return undefined
}

export function aliasFailure(error: AliasError): Failure {
  if (error.code === "alias_taken")
    return fail(
      "alias_taken",
      error.message,
      "Choose another alias; the holder is named in details.",
      error.details?.holder === undefined ? undefined : { holder: error.details.holder },
    )
  if (error.code === "alias_invalid")
    return fail("invalid_arguments", error.message, "Use 1-64 visible characters that do not look like a session id.", {
      reason: error.details?.reason,
    })
  if (error.code === "alias_not_found")
    return fail("not_found", error.message, "Call thread_list to see the threads and their aliases.")
  return fail("host_unavailable", error.message, "Retry when the account service is reachable.", {
    reason: error.details?.reason,
  })
}

/**
 * Where a session address points once the account is consulted (A3): another device's session, or this device. With
 * no id or alias match, `none` hands back the account list it read, so step 3 matches titles without a second read.
 */
export type RemoteTarget =
  | { readonly where: "remote"; readonly row: RemoteSessionRow }
  | { readonly where: "here"; readonly session_id: string }
  | { readonly where: "none"; readonly rows: readonly RemoteSessionRow[]; readonly here: string | null }

/**
 * The listing row an alias holder names. A thread claimed on its own device is held by its durable id, while the account
 * listing keys every session (terminal-held or rpc-host alike) by the relay key that device's connector assigned and names
 * only its project, so the row cannot be matched by durable id: the holding device maps it (session.locate, the same
 * lookup a create on another device uses). An offline holder device is device_offline; one that is online but cannot map
 * the holder to a session it lists is not_found.
 */
export async function holderTarget(
  remote: RemoteThreadSurface,
  holder: AliasHolder,
  here: string | null,
  rows: readonly RemoteSessionRow[],
): Promise<RemoteTarget | Failure> {
  if (holder.device === here) return { where: "here", session_id: holder.session_id }
  // A holder is recorded by its durable id (claimed on its own device) or by its listing key: match either.
  const listed = rows.find(
    (row) =>
      row.device === holder.device && (row.durable_id === holder.session_id || row.session_id === holder.session_id),
  )
  if (listed !== undefined) return { where: "remote", row: listed }
  const device = (await remote.sessions.devices()).find((candidate) => candidate.device === holder.device)
  if (device !== undefined && !device.online)
    return fail(
      "device_offline",
      `Device ${holder.device} holding this thread is offline.`,
      "Retry when that device is online; nothing was queued.",
      { device: holder.device, thread_id: holder.session_id },
    )
  const located = await remote.sessions.locate(holder.device, holder.session_id)
  const row =
    located.kind === "ok"
      ? rows.find((candidate) => candidate.device === holder.device && candidate.session_id === located.sessionId)
      : undefined
  if (row !== undefined) return { where: "remote", row }
  return fail(
    "not_found",
    `The alias names thread ${holder.session_id} on device ${holder.device}, which that device does not list.`,
    "Call thread_list with all_scope to find the live thread, then claim the alias for it again with thread_rename.",
    {
      device: holder.device,
      thread_id: holder.session_id,
      ...(located.kind === "refused" ? { reason: located.reason } : {}),
    },
  )
}

/** A typed `device_offline` when the device is known and not online; nothing is ever queued for it (A3). */
export async function deviceOnline(remote: RemoteThreadSurface, device: string): Promise<Failure | undefined> {
  const devices = await remote.sessions.devices()
  const row = devices.find((candidate) => candidate.device === device)
  if (row === undefined)
    return fail(
      "not_found",
      `No device named ${device} is signed in to this account.`,
      "Call thread_list with all_scope to see the account's devices and threads.",
      { device },
    )
  if (!row.online)
    return fail(
      "device_offline",
      `Device ${device} is offline.`,
      "Retry when that device is online; nothing was queued.",
      { device },
    )
  return undefined
}

/**
 * The engine's reply payload. The device service hands back senpi's whole response envelope
 * (`{type: "response", command, success, data}`), and every field a tool reads lives under `data`.
 */
export function replyData(response: JsonObject): JsonObject {
  const data = response["data"]
  return typeof data === "object" && data !== null && !Array.isArray(data) ? (data as JsonObject) : {}
}

/** How the send a follow belongs to was answered, so it prints only that send's own turn (#13267). */
type RemoteFollowLane = "started" | "queued" | "steered"

export type RemoteFollow = {
  /** "settled" once the turn this send started settles, "session_closed" when its close cut the run short, else the reason its attach ended first. */
  readonly settled: Promise<string>
  readonly stop: () => void
  /**
   * Names how the send's delivery answered, once its reply is known (#13267): `started` and `steered` print stream
   * deltas from the aim (a `started` turn that already finished before the aim is read once from the transcript);
   * `queued` reads the answer from the session's own transcript, anchored on the send's user entry - the stream's
   * arrival order can never prove which turn a record belongs to (a queued follow-up drains
   * inside the same run with plain `turn_start`/`turn_end` markers, retries open extra `agent_start` pairs, and a
   * late replay lands after the aim), so the stream only signals that a run settled and the transcript decides
   * what prints.
   */
  readonly aim: (lane: RemoteFollowLane) => void
}

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** How many trailing transcript entries a follow reads to find the send's own turn. */
const READ_TAIL = 256

/** The joined text of a transcript message entry, or undefined for anything that is not one. */
const entryTextOf = (entry: JsonObject): string | undefined => {
  const message = isRecord(entry["message"]) ? entry["message"] : entry["role"] !== undefined ? entry : undefined
  if (message === undefined) return undefined
  const content = message["content"]
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return undefined
  const texts: string[] = []
  for (const part of content)
    if (isRecord(part) && part["type"] === "text" && typeof part["text"] === "string") texts.push(part["text"])
  return texts.length > 0 ? texts.join("") : undefined
}

/** Whether a transcript entry is a user message, in either stored shape. */
export const isUserEntry = (entry: JsonObject): boolean => {
  const message = isRecord(entry["message"]) ? entry["message"] : entry
  return message["role"] === "user"
}

/** The client message id senpi stamped on a stored user entry (`clientMessageId` on the message), if any. */
const entryClientMessageIdOf = (entry: JsonObject): string | undefined => {
  const message = isRecord(entry["message"]) ? entry["message"] : entry
  const id = message["clientMessageId"]
  return typeof id === "string" && id !== "" ? id : undefined
}

/**
 * The matches that can anchor a send's turn. The user entry carrying the send's own client message id wins outright:
 * senpi stores it on the entry it admits, whatever text a prompt template or skill expansion stored (#13272 review).
 * An engine that stored no such id falls back to text: exact first, else entries containing it.
 */
export const anchorMatches = (entries: readonly JsonObject[], text: string, clientMessageId?: string): number[] => {
  if (clientMessageId !== undefined) {
    for (let index = 0; index < entries.length; index++)
      if (isUserEntry(entries[index]) && entryClientMessageIdOf(entries[index]) === clientMessageId) return [index]
  }
  const exact: number[] = []
  const contained: number[] = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (!isUserEntry(entry)) continue
    const entryText = entryTextOf(entry)
    if (entryText === undefined) continue
    if (entryText === text) exact.push(index)
    else if (entryText.includes(text)) contained.push(index)
  }
  return exact.length > 0 ? exact : contained
}

/**
 * Follows the answer to one send on another device's session. A queued send's user entry in the session's transcript
 * anchors its turn: its answer entries print once the turn is final - superseded by a later message's turn, or the
 * transcript's tail when a run settled - with the record stream as the completion signal. A started send or a steer
 * prints its deltas from the aim on instead, settling with its run.
 */
export async function followRemote(
  remote: RemoteThreadSurface,
  row: RemoteSessionRow,
  onText: (text: string) => void,
  options?: {
    /** The text the send delivered; its user entry in the transcript anchors a queued follow's answer. */
    readonly text?: string
    /** The client message id the send carried; the entry senpi stamps with it anchors before any text match. */
    readonly clientMessageId?: string
  },
): Promise<RemoteFollow | Failure> {
  const offline = await deviceOnline(remote, row.device)
  if (offline !== undefined) return offline
  let settle!: (end: string) => void
  const settled = new Promise<string>((resolve) => {
    settle = resolve
  })
  let done = false
  const end = (reason: string): void => {
    if (done) return
    done = true
    settle(reason)
  }
  let mode: "buffer" | "stream" | "transcript" = "buffer"
  let last: { readonly index: unknown; readonly endsLine: boolean } | undefined
  let newMessage = false
  let checking = false
  let pendingSignal = false
  // How many entries carried this send's text when a read first saw any: that count is this send's ordinal among
  // identical-text messages, because its own entry is the newest such entry at its admission (#13272 review).
  let matchOrdinal: number | undefined
  const check = async (settleSignal: boolean): Promise<void> => {
    const text = options?.text
    if (done || mode !== "transcript" || text === undefined) return
    if (checking) {
      if (settleSignal) pendingSignal = true
      return
    }
    checking = true
    try {
      const page = await remote.sessions.read(row.device, row.session_id, READ_TAIL)
      if (done || mode !== "transcript" || page.kind !== "ok") return
      const raw = page.response["entries"]
      if (!Array.isArray(raw)) return
      const entries = raw.filter(isRecord)
      const matches = anchorMatches(entries, text, options?.clientMessageId)
      if (matches.length === 0) return
      if (matchOrdinal === undefined) matchOrdinal = matches.length
      const anchor = matches[Math.min(matchOrdinal, matches.length) - 1]
      const answer: string[] = []
      let superseded = false
      let answerAtTail = false
      for (let index = anchor + 1; index < entries.length; index++) {
        const entry = entries[index]
        const message = isRecord(entry["message"]) ? entry["message"] : entry
        if (message["role"] === "user") {
          superseded = true
          break
        }
        if (message["role"] !== "assistant") continue
        const entryText = entryTextOf(entry)
        if (entryText !== undefined && entryText !== "") {
          answer.push(entryText)
          answerAtTail = true
        } else answerAtTail = false
      }
      // A later message's turn makes this send's turn final whether it wrote text or not: the wait ends instead of
      // living until the session closes (#13272 review).
      if (superseded) {
        for (const [index, entryText] of answer.entries()) {
          if (index > 0) onText("\n")
          onText(entryText)
        }
        return end("settled")
      }
      // A queued send whose run settled without writing any answer keeps waiting: its run may simply not have
      // started yet, and the attach's own end still ends the wait with a typed reason.
      if (answer.length === 0) return
      if (settleSignal && answerAtTail) {
        for (const [index, entryText] of answer.entries()) {
          if (index > 0) onText("\n")
          onText(entryText)
        }
        end("settled")
      }
    } finally {
      checking = false
      if (pendingSignal) {
        pendingSignal = false
        void check(true)
      }
    }
  }
  const streamRecord = (record: JsonObject): void => {
    if (record["type"] === "agent_settled")
      return end(record["reason"] === "session_closed" ? "session_closed" : "settled")
    if (record["type"] === "message_start" || record["type"] === "message_end") newMessage = true
    const event = record["assistantMessageEvent"]
    if (
      record["type"] !== "message_update" ||
      !isRecord(event) ||
      event["type"] !== "text_delta" ||
      typeof event["delta"] !== "string" ||
      event["delta"] === ""
    )
      return
    const delta = event["delta"]
    if (last !== undefined && !last.endsLine && (newMessage || event["contentIndex"] !== last.index)) onText("\n")
    newMessage = false
    last = { index: event["contentIndex"], endsLine: delta.endsWith("\n") }
    onText(delta)
  }
  const probe = async (settleSignal: boolean): Promise<void> => {
    const text = options?.text
    if (done || text === undefined) return
    const page = await remote.sessions.read(row.device, row.session_id, READ_TAIL)
    if (done || page.kind !== "ok") return
    const raw = page.response["entries"]
    if (!Array.isArray(raw)) return
    const entries = raw.filter(isRecord)
    const matches = anchorMatches(entries, text, options?.clientMessageId)
    if (matches.length === 0) return
    const anchor = matches[matches.length - 1]
    const answer: string[] = []
    let superseded = false
    let answerAtTail = false
    for (let index = anchor + 1; index < entries.length; index++) {
      const entry = entries[index]
      const message = isRecord(entry["message"]) ? entry["message"] : entry
      if (message["role"] === "user") {
        superseded = true
        break
      }
      if (message["role"] !== "assistant") continue
      const entryText = entryTextOf(entry)
      if (entryText !== undefined && entryText !== "") {
        answer.push(entryText)
        answerAtTail = true
      } else answerAtTail = false
    }
    // Final once a later message supersedes the turn, or once a run settled (the buffer's own trailing settle
    // counts: the turn finished before the aim) with this answer as the transcript's tail.
    if (!(superseded || (settleSignal && answerAtTail)) || answer.length === 0) return
    for (const [index, entryText] of answer.entries()) {
      if (index > 0) onText("\n")
      onText(entryText)
    }
    end("settled")
  }
  const buffer: JsonObject[] = []
  const receive = (record: JsonObject): void => {
    // A run's settle always ends the wait, whatever the mode (senpi settles a turn the session's close cut short
    // with reason session_closed).
    if (record["type"] === "agent_settled" && record["reason"] === "session_closed") return end("session_closed")
    if (mode === "buffer") {
      // The attach's replayed history is never this send's answer: it arrived before the aim and is dropped (#13267).
      buffer.push(record)
      return
    }
    if (mode === "stream") return streamRecord(record)
    // Transcript mode reads the answer from the session; the stream is only a signal - a settle, a run end or a
    // new user message means the transcript may hold this send's answer - because no event order can attribute a
    // queued follow-up's records to its turn (#13272 review).
    const type = record["type"]
    if (type === "agent_settled") void check(true)
    else if (type === "agent_end") void check(false)
    else if (type === "message_start" && isRecord(record["message"]) && record["message"]["role"] === "user")
      void check(false)
  }
  const aim: RemoteFollow["aim"] = (lane) => {
    if (done || mode !== "buffer") return
    if (lane === "queued") {
      mode = "transcript"
      void check(false)
      return
    }
    // A send that started or steered a turn streams its deltas from the aim on. Whatever the attach replayed before
    // the aim is history and is dropped; the wait ends at the run's settle - retries included (#13267, #13272
    // review). A started turn may also have already finished before this aim: the probe reads the transcript and
    // prints a superseded answer at once.
    mode = "stream"
    if (lane === "started") {
      // A run whose settle the buffer already holds ended before this aim: its settle is the probe's signal.
      const settledAlready = buffer.length > 0 && buffer[buffer.length - 1]?.["type"] === "agent_settled"
      void probe(settledAlready)
    }
  }
  const watched = await remote.sessions.watch(row.device, row.session_id, receive)
  if (watched.kind !== "ok") return outcomeFailure(watched, row.device)
  void watched.watch.ended.then(end)
  return { settled, stop: watched.watch.stop, aim }
}
