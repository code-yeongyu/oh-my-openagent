import { entryClientMessageIdOf, entryTextOf, isUserEntry } from "../thread/remote/remote-ops"
import type { ClientCore } from "./client"
import type { FollowEvent, FollowOutcome, JsonObject, R, ReadPage, SendReceipt, ThreadHandle } from "./types"

// A send's turn on an engine that stamps no client message id (#13481 C'): none of its records carries the send's id, so
// follow's SendTurn never sees it. As the thread tools' remote follow does (thread/remote/remote-ops.ts), the transcript
// decides instead: the user entries carrying the send's text that the session held before the send went out are earlier
// sends', and at a run's settle the first such entry not among them anchors this send's answer.

/**
 * How many trailing transcript entries the pre-send view and each settle's check read: the most one history read may
 * ask the device service for (device-service-core spec-proto.ts SESSION_READ_TAIL_MAX; a larger tail is refused).
 */
export const SEND_TAIL = 200

/** The send's text and the entries carrying it before it went out; `earlier` is undefined when that read failed. */
export type PreSend = { readonly text: string; readonly earlier: ReadonlySet<string> | undefined }

type Stored = { readonly key: string; readonly entry: JsonObject }

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const storedOf = (page: ReadPage): Stored[] =>
  page.entries.flatMap((item) =>
    "entry" in item && isObject(item.entry) ? [{ key: item.entry_id, entry: item.entry }] : [],
  )

const carrying = (entries: readonly Stored[], text: string): Stored[] =>
  entries.filter((stored) => isUserEntry(stored.entry) && entryTextOf(stored.entry)?.includes(text) === true)

// The follows on this client that wait on a send not made yet, per thread: only such a send pays the pre-send read.
const awaiting = new WeakMap<ClientCore, Map<ThreadHandle, number>>()

/** A follow from a send it does not have yet; the answer releases it (idempotent). */
export function expectSend(core: ClientCore, thread: ThreadHandle): () => void {
  const counts = awaiting.get(core) ?? new Map<ThreadHandle, number>()
  awaiting.set(core, counts)
  counts.set(thread, (counts.get(thread) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const left = (counts.get(thread) ?? 1) - 1
    if (left > 0) counts.set(thread, left)
    else counts.delete(thread)
  }
}

export const followsSend = (core: ClientCore, thread: ThreadHandle): boolean =>
  (awaiting.get(core)?.get(thread) ?? 0) > 0

/** The session's entries carrying `text`, read before the send goes out. */
export async function preSendView(text: string, read: () => R<ReadPage>): Promise<PreSend> {
  const page = await read()
  if (page.kind !== "ok") return { text, earlier: undefined }
  return { text, earlier: new Set(carrying(storedOf(page.value), text).map((stored) => stored.key)) }
}

// The pre-send view rides with the receipt object the send answers, never inside it: the receipt is the --json answer.
const views = new WeakMap<SendReceipt, PreSend>()
export const attachPreSend = (receipt: SendReceipt, view: PreSend): void => void views.set(receipt, view)

type Answer = { readonly texts: readonly string[]; readonly interrupted: boolean }

/** This send's final answer in `entries` at a run's settle, or undefined while the transcript cannot tell yet. */
function answerAt(entries: readonly Stored[], view: PreSend): Answer | undefined {
  const earlier = view.earlier
  if (earlier === undefined) return undefined
  // An engine that stores ids stamps this send's records too: they decide, never a text match.
  if (entries.some((stored) => isUserEntry(stored.entry) && entryClientMessageIdOf(stored.entry) !== undefined))
    return undefined
  // remote-ops' check: the first exact entry not held before the send, else the first one wrapping the text. Inherited
  // gap (oh-my-openagent#13580): an identical entry stored between the pre-send read and this prompt landing (another
  // sender's identical message) is indistinguishable from this send's without ids, and the first of them wins.
  const unseen = carrying(entries, view.text).filter((stored) => !earlier.has(stored.key))
  const own = unseen.find((stored) => entryTextOf(stored.entry) === view.text) ?? unseen[0]
  if (own === undefined) return undefined
  const texts: string[] = []
  let superseded = false
  let answerAtTail = false
  let stopReason: unknown
  for (const stored of entries.slice(entries.indexOf(own) + 1)) {
    const message = isObject(stored.entry["message"]) ? stored.entry["message"] : stored.entry
    if (message["role"] === "user") {
      superseded = true
      break
    }
    if (message["role"] !== "assistant") continue
    stopReason = message["stopReason"]
    const text = entryTextOf(stored.entry)
    answerAtTail = text !== undefined && text !== ""
    if (answerAtTail && text !== undefined) texts.push(text)
  }
  const interrupted = stopReason === "aborted"
  if (superseded || answerAtTail || interrupted) return { texts, interrupted }
  return undefined
}

/** The follow events and end of a transcript answer, under the receipt's turn id. */
export function answerEvents(answer: Answer, from: SendReceipt): { text: FollowEvent[]; end: FollowOutcome } {
  const text = answer.texts.flatMap((delta, index): FollowEvent[] =>
    index > 0
      ? [
          { kind: "text", delta: "\n" },
          { kind: "text", delta },
        ]
      : [{ kind: "text", delta }],
  )
  const joined = answer.texts.join("\n")
  return {
    text,
    end: {
      reason: answer.interrupted ? "interrupted" : "settled",
      ...(answer.interrupted || joined === "" ? {} : { text: joined }),
      ...(from.turn_id === undefined ? {} : { turn_id: from.turn_id }),
    },
  }
}

export type TranscriptFallback = { readonly settled: () => void; readonly stop: () => void }

/** The transcript check for a follow or wait from `from`, when its send read the session before it went out. */
export const fallbackFor = (
  from: SendReceipt | undefined,
  read: () => R<ReadPage>,
  onAnswer: (answer: Answer) => void,
): TranscriptFallback | undefined => {
  const view = from === undefined ? undefined : views.get(from)
  return view === undefined ? undefined : transcriptFallback(view, read, onAnswer)
}

/** Checks the transcript at each settle, one read at a time, until it answers once (`onAnswer`) or is stopped. */
function transcriptFallback(
  view: PreSend,
  read: () => R<ReadPage>,
  onAnswer: (answer: Answer) => void,
): TranscriptFallback {
  let done = false
  let checking = false
  let again = false
  const check = async (): Promise<void> => {
    checking = true
    try {
      const page = await read()
      if (done || page.kind !== "ok") return
      const answer = answerAt(storedOf(page.value), view)
      if (answer === undefined) return
      done = true
      onAnswer(answer)
    } finally {
      checking = false
      if (again && !done) {
        again = false
        void check()
      }
    }
  }
  return {
    settled: () => {
      if (done) return
      if (checking) again = true
      else void check()
    },
    stop: () => {
      done = true
    },
  }
}
