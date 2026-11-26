import { createHash } from "node:crypto"

import type { ThreadToolResult } from "../contracts"
import type { ThreadErrorCode, ThreadToolFailure } from "../errors"
import { type GuidanceId, guidanceOf, provenanceOf, type RefusalId, replayRefusal } from "../refusal-texts"
import { parseThreadLinkUrl, threadLink } from "../thread-link"
import { repeatedGuidance } from "./prompt-guidance"

// What a receipt stores (design lane ruling on the receipts table, #14951): never the caller's key and never the caller's
// input text. The key is a hash over the book's own scope, so the store cannot list anyone's keys; a result is stored as
// structure whose values are core identifiers, closed values, timestamps, or typed references to an input field by name,
// filled from the ANSWERING call's own input on a repeat (its fingerprint is equal, so the value is the same).

const INPUT = "\u0000input"
const LINK = "\u0000link"
const GUIDE = "\u0000guide"
const LINK_FORMAT = /^\[(.*)\]\((omo-thread:\/\/v1\/[^)]+)\)$/s
// The fields whose value is a core-produced identifier (design lane ruling): stored as it is, even when an input is part of
// it (thread "peer" resolves to "dur-peer"; a worktree's path names its branch), and by reference only when the whole value
// equals an input field. Any other text that carries input is left out of the record.
const IDENTIFIERS: ReadonlySet<string> = new Set([
  "thread",
  "thread_id",
  "session_id",
  "sessionId",
  "durable_id",
  "delivery_id",
  "turn_id",
  "device",
  "root_id",
  "cwd",
  "path",
  "repository",
  "base",
  "branch",
])

/** The stored key: the scope's hash, so a lookup and the stored value agree and the key itself never lands on disk. */
export function storedKey(principal: string, operation: string, key: string): string {
  return createHash("sha256").update(`${principal}\u0000${operation}\u0000${key}`).digest("hex")
}

type Leaves = ReadonlyMap<string, string>

/** Every string the call was given, by its path in the input (`thread`, `prompt.message`, ...). */
function inputLeaves(value: unknown, path = "", into = new Map<string, string>()): Leaves {
  if (typeof value === "string") {
    if (value !== "" && path !== "") into.set(path, value)
  } else if (Array.isArray(value)) value.forEach((item, index) => inputLeaves(item, `${path}[${index}]`, into))
  else if (typeof value === "object" && value !== null)
    for (const [key, item] of Object.entries(value)) inputLeaves(item, path === "" ? key : `${path}.${key}`, into)
  return into
}

const referenceTo = (leaves: Leaves, text: string): string | undefined => {
  for (const [path, value] of leaves) if (value === text) return path
  return undefined
}

const carriesInput = (leaves: Leaves, text: string): boolean =>
  [...leaves.values()].some((value) => text.includes(value))

/** A core identifier: a reference when it is a whole input field, else its literal value. */
function identifier(leaves: Leaves, value: string): unknown {
  const whole = referenceTo(leaves, value)
  return whole === undefined ? value : { [INPUT]: whole }
}

function encodeValue(value: unknown, leaves: Leaves): unknown {
  if (typeof value === "string") {
    const whole = referenceTo(leaves, value)
    if (whole !== undefined) return { [INPUT]: whole }
    const link = LINK_FORMAT.exec(value)
    const target = link === null ? null : parseThreadLinkUrl(link[2] ?? "")
    if (link !== null && target !== null) {
      // threadLink escaped the label; the record keeps the label as it was given, so a reference can match the input.
      const title = (link[1] ?? "").replace(/\\(.)/gs, "$1")
      const titleRef = referenceTo(leaves, title)
      return {
        [LINK]: {
          id: target.threadId,
          title: titleRef === undefined ? (carriesInput(leaves, title) ? null : title) : { [INPUT]: titleRef },
        },
      }
    }
    // Text the core built around the input cannot be stored without it, so the record leaves it out.
    return carriesInput(leaves, value) ? undefined : value
  }
  if (Array.isArray(value)) return value.map((item) => encodeValue(item, leaves)).filter((item) => item !== undefined)
  if (typeof value === "object" && value !== null) {
    const guided = guidanceOf(value)
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => {
          // A guidance sentence is stored as its template and slots (identifiers), never as the sentence.
          if (guided !== undefined && key === guided.field)
            return [
              key,
              {
                [GUIDE]: {
                  id: guided.id,
                  slots: Object.fromEntries(
                    Object.entries(guided.slots).map(([name, slot]) => [name, identifier(leaves, slot)]),
                  ),
                },
              },
            ] as const
          return [
            key,
            IDENTIFIERS.has(key) && typeof item === "string" ? identifier(leaves, item) : encodeValue(item, leaves),
          ] as const
        })
        .filter(([, item]) => item !== undefined),
    )
  }
  return value
}

function inputAt(value: unknown, path: string): unknown {
  let node = value
  for (const part of path.split(/\.|\[(\d+)\]/).filter((segment) => segment !== undefined && segment !== ""))
    node = typeof node === "object" && node !== null ? (node as Record<string, unknown>)[part] : undefined
  return node
}

function decodeValue(value: unknown, input: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => decodeValue(item, input))
  if (typeof value !== "object" || value === null) return value
  const record = value as Record<string, unknown>
  if (typeof record[INPUT] === "string") return inputAt(input, record[INPUT])
  const link = record[LINK] as { readonly id: unknown; readonly title: unknown } | undefined
  if (link !== undefined) {
    const title = decodeValue(link.title, input)
    return threadLink(String(decodeValue(link.id, input) ?? ""), typeof title === "string" ? title : null)
  }
  const plain: Record<string, unknown> = Object.fromEntries(
    Object.entries(record)
      .filter(([, item]) => !isGuide(item))
      .map(([key, item]) => [key, decodeValue(item, input)]),
  )
  // A guidance field is rendered again from its template, judged against the decoded record it sits in.
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, item]) => {
      if (!isGuide(item)) return [[key, plain[key]]]
      const { id, slots } = item[GUIDE]
      const filled = Object.fromEntries(
        Object.entries(slots).map(([name, slot]) => [name, String(decodeValue(slot, input) ?? "")]),
      )
      const text = repeatedGuidance(id, filled, plain)
      return text === undefined ? [] : [[key, text]]
    }),
  )
}

type StoredGuide = { readonly [GUIDE]: { readonly id: GuidanceId; readonly slots: Readonly<Record<string, unknown>> } }
const isGuide = (item: unknown): item is StoredGuide => typeof item === "object" && item !== null && GUIDE in item

/** The calls whose record is their outcome code only: a repeat re-runs them (a read has no effect to protect). */
export const RERUN_ON_REPEAT: ReadonlySet<string> = new Set(["thread_list", "thread_read"])

/** The record a receipt stores for `result`, given the call's own input. */
export function encodeResult(operation: string, result: ThreadToolResult, input: unknown): unknown {
  if (RERUN_ON_REPEAT.has(operation))
    return result.kind === "error" ? { kind: "error", error: { code: result.error.code } } : { kind: result.kind }
  const leaves = inputLeaves(input)
  if (result.kind === "error") return { kind: "error", error: encodeRefusal(result.error, leaves) }
  return encodeValue(result, leaves)
}

/** A refusal as its code, the template refusal() rendered it from with each slot by reference or literal, and its details. */
function encodeRefusal(error: ThreadToolFailure, leaves: Leaves): StoredRefusal {
  const details =
    error.details === undefined ? undefined : (encodeValue(error.details, leaves) as Record<string, unknown>)
  const base = { code: error.code, ...(details === undefined ? {} : { details }) }
  const made = provenanceOf(error)
  if (made === undefined) return base
  const slots: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(made.slots)) {
    const whole = referenceTo(leaves, value)
    if (whole !== undefined) slots[name] = { [INPUT]: whole }
    else if (carriesInput(leaves, value)) return base
    else slots[name] = value
  }
  return { ...base, template: made.id, slots }
}

type StoredRefusal = {
  readonly code: ThreadErrorCode
  readonly details?: Readonly<Record<string, unknown>>
  readonly template?: RefusalId
  readonly slots?: Readonly<Record<string, unknown>>
}

/** The answer a repeat gets from a stored record, the references filled from the repeating call's own input. */
export function decodeResult(record: unknown, input: unknown): ThreadToolResult {
  const stored = record as { readonly kind: string; readonly error?: StoredRefusal }
  if (stored.kind !== "error" || stored.error === undefined) return decodeValue(record, input) as ThreadToolResult
  const { code, details, template, slots } = stored.error
  const filled = Object.fromEntries(
    Object.entries(slots ?? {}).map(([name, value]) => [name, String(decodeValue(value, input) ?? "")]),
  )
  const decodedDetails = details === undefined ? undefined : (decodeValue(details, input) as Record<string, unknown>)
  return { kind: "error", error: replayRefusal(code, template, filled, decodedDetails) } as ThreadToolResult
}

/** A stored note with its references filled from the retrying call's own input, for that call's answer and recovery. */
export function decodeNote(note: string | null, input: unknown): string | null {
  if (note === null || !note.startsWith("{")) return note
  try {
    const parsed = JSON.parse(note) as { readonly message?: unknown; readonly details?: unknown }
    return parsed.details === undefined
      ? note
      : JSON.stringify({ ...parsed, details: decodeValue(parsed.details, input) })
  } catch {
    return note
  }
}

/** An uncertain call's note: its closed code and identifier details only. */
export function encodeNote(error: { readonly code: string; readonly details?: unknown }, input: unknown): string {
  const details = error.details === undefined ? undefined : encodeValue(error.details, inputLeaves(input))
  return JSON.stringify({ message: error.code, ...(details === undefined ? {} : { details }) })
}
