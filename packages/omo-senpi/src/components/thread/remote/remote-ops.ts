import { threadToolFailure, type ThreadToolFailure } from "../errors"
import type { CommandResult } from "@oh-my-opencode/device-service-core"
import type { RemoteClient } from "../../remote"
import { accountDevices, accountState } from "./account"
import { notSignedInFailure, outcomeFailure, READ_UNCERTAIN } from "./outcome"
import {
  endedRow,
  probeMayBuildEndedRow,
  type AliasError,
  type AliasHolder,
  type RemoteDevice,
  type JsonObject,
  type RemoteSessionRow,
  type RemoteThreadSurface,
} from "./ports"

type Failure = { readonly kind: "error"; readonly error: ThreadToolFailure }
const fail = (
  code: ThreadToolFailure["code"],
  message: string,
  next: string,
  details?: Readonly<Record<string, unknown>>,
): Failure => ({ kind: "error", error: threadToolFailure(code, message, next, details) })

/** A5: the relay is paid only; on any other plan the remote path answers this, never a silent failure or a queue. */
export async function remoteAvailable(remote: RemoteThreadSurface): Promise<Failure | undefined> {
  const ready = await remoteReady(remote)
  return "kind" in ready ? ready : undefined
}

/** remoteAvailable, and on a connected relay this device's account id, read in the same status round. */
export async function remoteReady(remote: RemoteThreadSurface): Promise<Failure | { readonly here: string | null }> {
  const status = await accountState(remote.client)
  if ("kind" in status)
    return fail(
      "host_unavailable",
      "This device's device service is not reachable.",
      "Install or start the device service, then retry.",
      // No device service at all is "not set up" (no state); a service that answers with a failure is an outage.
      status.details?.["reason"] === "service_not_installed"
        ? { reason: status.message }
        : { reason: status.message, state: "unreachable" },
    )
  const state = status.state
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
  return { here: status.here }
}

/** An alias holder as a failure names it: the thread to pass back, and its device. */
export function holderDetails(holder: AliasHolder): { readonly thread: string; readonly device: string } {
  return { thread: holder.session_id, device: holder.device }
}

export function aliasFailure(error: AliasError): Failure {
  if (error.code === "alias_taken")
    return fail(
      "alias_taken",
      error.message,
      "Choose another alias; the holder is named in details.",
      error.details?.holder === undefined ? undefined : { holder: holderDetails(error.details.holder) },
    )
  if (error.code === "alias_invalid")
    return fail("invalid_arguments", error.message, "Use 1-64 visible characters that do not look like a session id.", {
      reason: error.details?.reason,
    })
  if (error.code === "alias_not_found")
    return fail(
      "not_found",
      error.message,
      "Call thread_list (tool.thread_list() in an eval cell) to see the threads and their aliases.",
    )
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
 * the holder to a session it lists is not_found. A holder device the account's roster no longer names (removed from the
 * account, #13505) is not_found without that probe; with no roster (`undefined`) the account's device list is read here.
 */
export async function holderTarget(
  remote: RemoteThreadSurface,
  holder: AliasHolder,
  here: string | null,
  rows: readonly RemoteSessionRow[],
  roster: readonly RemoteDevice[] | undefined,
): Promise<RemoteTarget | Failure> {
  if (holder.device === here) return { where: "here", session_id: holder.session_id }
  // A holder is recorded by its durable id (claimed on its own device) or by its listing key: match either.
  const listed = rows.find(
    (row) =>
      row.device === holder.device && (row.durable_id === holder.session_id || row.session_id === holder.session_id),
  )
  if (listed !== undefined) return { where: "remote", row: listed }
  const device = (roster ?? (await accountDevices(remote.client)).devices).find(
    (candidate) => candidate.device === holder.device,
  )
  if (roster !== undefined && device === undefined)
    return fail(
      "not_found",
      `The alias names thread ${holder.session_id} on device ${holder.device}, which is no longer on this account.`,
      "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) to find the live thread, then claim the alias for it again with thread_rename (tool.thread_rename()).",
      { device: holder.device, thread: holder.session_id },
    )
  if (device !== undefined && !device.online)
    return fail(
      "device_offline",
      `Device ${holder.device} holding this thread is offline.`,
      "Retry when that device is online; nothing was queued.",
      { device: holder.device, thread: holder.session_id },
    )
  const located = await remote.sessions.locate(holder.device, holder.session_id)
  const row =
    located.kind === "ok"
      ? rows.find((candidate) => candidate.device === holder.device && candidate.session_id === located.sessionId)
      : undefined
  if (row !== undefined) return { where: "remote", row }
  // omo#13037 A4.3.2: the holder's device answered the probe for a session no engine lists: an ended row from that answer,
  // only while this device's service can carry the wake (else today's not_found below).
  if (located.kind === "ok" && (await probeMayBuildEndedRow(remote.sessions)))
    return { where: "remote", row: endedRow(holder.device, located.sessionId, holder.session_id) }
  const notSignedIn = located.kind === "refused" ? notSignedInFailure(located.reason, holder.device) : undefined
  if (notSignedIn !== undefined) return notSignedIn
  return fail(
    "not_found",
    `The alias names thread ${holder.session_id} on device ${holder.device}, which that device does not list.`,
    "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) to find the live thread, then claim the alias for it again with thread_rename (tool.thread_rename() in an eval cell).",
    {
      device: holder.device,
      thread: holder.session_id,
      ...(located.kind === "refused" ? { reason: located.reason } : {}),
    },
  )
}

/** A typed `device_offline` when the device is known and not online; nothing is ever queued for it (A3). */
export async function deviceOnline(remote: RemoteThreadSurface, device: string): Promise<Failure | undefined> {
  const listed = await listedDevices(remote.client, device)
  return "kind" in listed ? listed : deviceRefusal(listed.devices, device)
}

/** The account's devices, or a typed host_unavailable naming `device` when this device's service cannot list them. */
export async function listedDevices(
  client: RemoteClient,
  device: string,
): Promise<{ readonly devices: readonly RemoteDevice[] } | Failure> {
  try {
    return { devices: (await accountDevices(client)).devices }
  } catch (error) {
    return fail(
      "host_unavailable",
      "This device's device service could not list the account's devices.",
      "Retry when the device service is reachable.",
      { device, reason: error instanceof Error ? error.message : String(error) },
    )
  }
}

/** deviceOnline over a device list the caller already read: not_found for an unknown id, device_offline for an offline one. */
export function deviceRefusal(devices: readonly RemoteDevice[], device: string): Failure | undefined {
  const row = devices.find((candidate) => candidate.device === device)
  if (row === undefined)
    return fail(
      "not_found",
      `No device named ${device} is signed in to this account.`,
      "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) to see the account's devices and threads.",
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
  /** "settled" once the turn this send started settles, "interrupted" when that turn was stopped before it finished, "session_closed" when its close cut the run short, else the reason its attach ended first. */
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

/** A stored entry's identity: its own `id`, or its whole record when it has none. */
const entryKeyOf = (entry: JsonObject): string =>
  typeof entry["id"] === "string" ? entry["id"] : JSON.stringify(entry)

/** The user entries whose text carries `text`, exact or wrapped, in transcript order. */
const textCarryingUserEntries = (entries: readonly JsonObject[], text: string): number[] => {
  const found: number[] = []
  for (let index = 0; index < entries.length; index++) {
    if (!isUserEntry(entries[index])) continue
    if (entryTextOf(entries[index])?.includes(text) === true) found.push(index)
  }
  return found
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
  // An id-carrying send: the user entries carrying its text before it is sent (read before the watch, so before the
  // send). On an engine that stamps no id they are all earlier sends, finished or not, and a prompt matched only by
  // its text is never one of them; undefined when the read failed, and then no text match counts (#13481 delta M1).
  let storedBeforeSend: ReadonlySet<string> | undefined
  if (options?.text !== undefined && options.clientMessageId !== undefined) {
    const page = await remote.sessions.read(row.device, row.session_id, READ_TAIL)
    const raw = page.kind === "ok" ? page.response["entries"] : undefined
    if (Array.isArray(raw)) {
      const entries = raw.filter(isRecord)
      storedBeforeSend = new Set(
        textCarryingUserEntries(entries, options.text).map((index) => entryKeyOf(entries[index])),
      )
    }
  }
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
  // Without a client message id: this send's ordinal among identical-text entries, fixed at its first read (its own
  // entry assumed the newest).
  let matchOrdinal: number | undefined
  // With an id the engine has not stamped: the identities of the user entries carrying this send's text at its first
  // read. A queued entry is stored only when the queue drains, so every one of them is an earlier send (#13272 review).
  let earlierEntries: ReadonlySet<string> | undefined
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
      const clientMessageId = options?.clientMessageId
      const own =
        clientMessageId === undefined
          ? -1
          : entries.findIndex((entry) => isUserEntry(entry) && entryClientMessageIdOf(entry) === clientMessageId)
      let anchor: number
      if (own >= 0) anchor = own
      else {
        const matches = anchorMatches(entries, text)
        if (clientMessageId === undefined) {
          if (matches.length === 0) return
          if (matchOrdinal === undefined) matchOrdinal = matches.length
          anchor = matches[Math.min(matchOrdinal, matches.length) - 1]
        } else {
          // senpi stores a queued send's entry only when the queue drains, so a send that carries an id and finds no
          // entry with it has not been stored yet: every user entry carrying its text that its first read sees is an
          // earlier send. Its own is the first exact one after those, else the first wrapped one (another message that merely
          // contains the text must not win over the send's own exact entry), keyed by entry identity so older
          // entries scrolling out of the read window cannot shift it (#13272 review). It waits for that entry rather
          // than print an older answer.
          const carrying = textCarryingUserEntries(entries, text)
          if (earlierEntries === undefined)
            earlierEntries = new Set(carrying.map((index) => entryKeyOf(entries[index])))
          const seen = earlierEntries
          const unseen = carrying.filter((index) => !seen.has(entryKeyOf(entries[index])))
          const fresh = unseen.find((index) => entryTextOf(entries[index]) === text) ?? unseen[0]
          if (fresh === undefined) return
          anchor = fresh
        }
      }
      const answer: string[] = []
      let superseded = false
      let answerAtTail = false
      let stopReason: unknown
      for (let index = anchor + 1; index < entries.length; index++) {
        const entry = entries[index]
        const message = isRecord(entry["message"]) ? entry["message"] : entry
        if (message["role"] === "user") {
          superseded = true
          break
        }
        if (message["role"] !== "assistant") continue
        stopReason = message["stopReason"]
        const entryText = entryTextOf(entry)
        if (entryText !== undefined && entryText !== "") {
          answer.push(entryText)
          answerAtTail = true
        } else answerAtTail = false
      }
      // A later message's turn makes this send's turn final whether it wrote text or not: the wait ends instead of
      // living until the session closes (#13272 review).
      // A turn stopped before it finished stores its last assistant message as "aborted" (#13272 review).
      const interrupted = stopReason === "aborted"
      if (superseded) {
        for (const [index, entryText] of answer.entries()) {
          if (index > 0) onText("\n")
          onText(entryText)
        }
        return end(interrupted ? "interrupted" : "settled")
      }
      // A queued send whose run settled without writing any answer keeps waiting: its run may simply not have
      // started yet, and the attach's own end still ends the wait with a typed reason. An interrupted turn is final
      // with or without text.
      if (answer.length === 0 && !(settleSignal && interrupted)) return
      if (settleSignal && (answerAtTail || interrupted)) {
        for (const [index, entryText] of answer.entries()) {
          if (index > 0) onText("\n")
          onText(entryText)
        }
        end(interrupted ? "interrupted" : "settled")
      }
    } finally {
      checking = false
      if (pendingSignal) {
        pendingSignal = false
        void check(true)
      }
    }
  }
  // The stop reason of the run's last assistant message: an interrupted turn ends its run with "aborted" (#13272).
  let lastStopReason: unknown
  // What the stream printed from the aim on: the probe prints only the part of the stored answer it has not (#13481).
  let streamed = ""
  const streamRecord = (record: JsonObject): void => {
    if (record["type"] === "agent_settled") {
      if (record["reason"] === "session_closed") return end("session_closed")
      return end(lastStopReason === "aborted" ? "interrupted" : "settled")
    }
    // Each run starts with no stop reason of its own (#13272 review).
    if (record["type"] === "agent_start") lastStopReason = undefined
    if (record["type"] === "message_end") {
      const message = record["message"]
      if (isRecord(message) && message["role"] === "assistant") lastStopReason = message["stopReason"]
    }
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
    if (last !== undefined && !last.endsLine && (newMessage || event["contentIndex"] !== last.index)) {
      streamed += "\n"
      onText("\n")
    }
    newMessage = false
    last = { index: event["contentIndex"], endsLine: delta.endsWith("\n") }
    streamed += delta
    onText(delta)
  }
  // Whether a buffered stream record is this send's own prompt: senpi streams the prompt's user message as the run
  // starts, and stores its entry at that message's end. A message carrying this send's client message id is its own
  // ("id"); one carrying any other id never is, whether this send has an id or not. An unstamped message carrying the
  // send's text matches by text ("text"): a send with no id stores no id, and an engine that keeps no id stamps none
  // (#13481 review M1, L1).
  const promptMatchOf = (record: JsonObject): "id" | "text" | undefined => {
    const text = options?.text
    if (text === undefined || record["type"] !== "message_end" || !isUserEntry(record)) return undefined
    const stamped = entryClientMessageIdOf(record)
    if (stamped !== undefined) return stamped === options?.clientMessageId ? "id" : undefined
    return entryTextOf(record)?.includes(text) === true ? "text" : undefined
  }
  // Whether a record shows the engine stamps client message ids: then an id-carrying send's own prompt carries its id,
  // and an unstamped same-text prompt is an earlier send's (a send without --wait, text typed in the TUI) (#13481 review M1).
  const showsStamping = (record: JsonObject): boolean =>
    isUserEntry(record) && entryClientMessageIdOf(record) !== undefined
  /**
   * Reads the transcript once for a started turn that may have finished, or been superseded, before the aim.
   * `settleSignal`: this turn's own run settled before the aim. `promptStored`: the stream showed this send's prompt
   * stored before the read, so the newest entry carrying its text is its own; without that (and without its client
   * message id on an entry) the newest text match may be an earlier identical send, and nothing prints (#13481 review M1).
   * `storedByText`: an id-carrying send's prompt was matched only by its text (an engine that keeps no id), which holds
   * only while the transcript shows no stamped entry either (#13481 review L1).
   */
  const probe = async (settleSignal: boolean, promptStored: boolean, storedByText: boolean): Promise<void> => {
    const text = options?.text
    if (done || text === undefined) return
    const page = await remote.sessions.read(row.device, row.session_id, READ_TAIL)
    if (done || page.kind !== "ok") return
    const raw = page.response["entries"]
    if (!Array.isArray(raw)) return
    const entries = raw.filter(isRecord)
    const clientMessageId = options?.clientMessageId
    const own =
      clientMessageId === undefined
        ? -1
        : entries.findIndex((entry) => isUserEntry(entry) && entryClientMessageIdOf(entry) === clientMessageId)
    let anchor = own
    if (anchor < 0) {
      if (!promptStored) return
      // A prompt matched only by its text is this id-carrying send's only on an engine that stamps no id: a stamped
      // entry in the transcript says the matched prompt is an earlier send's (#13481 review M1, L1).
      if (storedByText && entries.some(showsStamping)) return
      // Nor is it an entry the transcript already held before the send: that is an earlier prompt with its own run,
      // whatever settle the buffer holds after it (#13481 delta M1). Entries stored between the send starting and its prompt landing are indistinguishable without ids (oh-my-openagent#13580).
      if (storedByText && storedBeforeSend === undefined) return
      const before = storedByText ? storedBeforeSend : undefined
      const matches = anchorMatches(entries, text).filter(
        (index) => before === undefined || !before.has(entryKeyOf(entries[index])),
      )
      if (matches.length === 0) return
      anchor = matches[matches.length - 1]
    }
    const answer: string[] = []
    let superseded = false
    let answerAtTail = false
    let stopReason: unknown
    for (let index = anchor + 1; index < entries.length; index++) {
      const entry = entries[index]
      const message = isRecord(entry["message"]) ? entry["message"] : entry
      if (message["role"] === "user") {
        superseded = true
        break
      }
      if (message["role"] !== "assistant") continue
      stopReason = message["stopReason"]
      const entryText = entryTextOf(entry)
      if (entryText !== undefined && entryText !== "") {
        answer.push(entryText)
        answerAtTail = true
      } else answerAtTail = false
    }
    // Final once a later message supersedes the turn, or once a run settled (the buffer's own trailing settle
    // counts: the turn finished before the aim) with this answer as the transcript's tail.
    const interrupted = stopReason === "aborted"
    if (!(superseded || (settleSignal && (answerAtTail || interrupted)))) return
    if (answer.length === 0 && !interrupted) return
    const stored = answer.join("\n")
    if (streamed === "")
      for (const [index, entryText] of answer.entries()) {
        if (index > 0) onText("\n")
        onText(entryText)
      }
    else {
      // The stream printed from the aim on: of this turn's stored answer only what it has not printed yet is written,
      // so the answer prints once (#13481). Deltas that are not this answer (a later message's turn streaming after
      // the aim of a superseded send) never drop it: it prints after them (#13481 review L3).
      if (stored.startsWith(streamed)) {
        if (stored.length > streamed.length) onText(stored.slice(streamed.length))
      } else if (!streamed.startsWith(stored)) {
        if (!streamed.endsWith("\n")) onText("\n")
        onText(stored)
      }
    }
    end(interrupted ? "interrupted" : "settled")
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
    // The run's own records the buffer already holds (after its agent_start) still say how its last message ended:
    // a turn aborted before the aim and settled after it is interrupted, not settled (#13272 review L2).
    const runStart = buffer.findLastIndex((record) => record["type"] === "agent_start")
    // A run the buffer already saw settle is an earlier run, not this send's: its stop reason marks nothing (#13272 review).
    const runSettled = runStart >= 0 && buffer.slice(runStart + 1).some((record) => record["type"] === "agent_settled")
    if (runStart >= 0 && !runSettled)
      for (const record of buffer.slice(runStart + 1)) {
        const ended = record["message"]
        if (record["type"] === "message_end" && isRecord(ended) && ended["role"] === "assistant")
          lastStopReason = ended["stopReason"]
      }
    if (lane === "started") {
      // This send's run ended before the aim only when the buffer holds a settle AFTER this send's own prompt: a settle
      // buffered with no prompt of its own before it is an earlier run's, never this turn's signal (#13481 review M1).
      // A send with an id takes a prompt matched by its text only while nothing buffered shows the engine stamps ids:
      // an engine that keeps no id stamps none, so its turn that finished before the aim still prints (#13481 review L1).
      const byId = buffer.findLastIndex((record) => promptMatchOf(record) === "id")
      const textAllowed = options?.clientMessageId === undefined || !buffer.some(showsStamping)
      const byText = byId >= 0 || !textAllowed ? -1 : buffer.findLastIndex((record) => promptMatchOf(record) === "text")
      const ownPrompt = byId >= 0 ? byId : byText
      const settledAlready =
        ownPrompt >= 0 && buffer.slice(ownPrompt + 1).some((record) => record["type"] === "agent_settled")
      void probe(settledAlready, ownPrompt >= 0, byId < 0 && options?.clientMessageId !== undefined)
    }
  }
  // A gap in the attach ends the follow with its reason, as an ended attach always did: the send's own turn may have
  // settled unseen, and the CLI answers that typed instead of waiting through a resync.
  const watched = await remote.sessions.watch(row.device, row.session_id, { record: receive, lost: end })
  if (watched.kind !== "ok") return outcomeFailure(watched, row.device)
  void watched.watch.ended.then(end)
  return { settled, stop: watched.watch.stop, aim }
}
