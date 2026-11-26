import { ADDRESS_TEXTS } from "./address-refusal-texts"
import { CONTROL_TEXTS } from "./control-refusal-texts"
import type { ThreadErrorCode } from "./errors"
import { threadToolFailure, type ThreadToolFailure } from "./errors"
import { READ_TEXTS } from "./read-refusal-texts"
import { RELAY_TEXTS } from "./relay-refusal-texts"

// The one producer of a keyed refusal's sentence (#14951, design lane ruling): each refusal is TEMPLATE DATA with named
// slots, so the same table renders the first answer, a receipt records the template id and slots the producer attached
// (each slot by reference when it is a whole input field, never the text), and a repeat renders from the repeating call's
// own input, byte-equal to the first.

export type RefusalText = {
  readonly code: ThreadErrorCode
  /** `{slot}` fills a value; `{{` and `}}` are literal braces. */
  readonly message: string
  readonly next_action: string
}

/** A guidance sentence an ok answer carries (a field such as a prompt's `next_action`), rendered like a refusal's. */
export type GuidanceText = {
  /** `{slot}` fills a value; `{{` and `}}` are literal braces. */
  readonly guidance: string
}

export const REFUSAL_TEXTS = { ...CONTROL_TEXTS, ...ADDRESS_TEXTS, ...RELAY_TEXTS, ...READ_TEXTS } as const
type Texts = typeof REFUSAL_TEXTS
export type RefusalId = { [K in keyof Texts]: Texts[K] extends RefusalText ? K : never }[keyof Texts]
export type GuidanceId = { [K in keyof Texts]: Texts[K] extends GuidanceText ? K : never }[keyof Texts]

/** What a repeat answers for a refusal no template produced (an engine's own message): fixed text for its code. */
const FIXED_TEXT: Readonly<Partial<Record<ThreadErrorCode, Omit<RefusalText, "code">>>> = {}

const SLOT = /\{\{|\}\}|\{([a-z_]+)\}/g

function fill(template: string, slots: Readonly<Record<string, string>>): string {
  return template.replace(SLOT, (token, name: string | undefined) => {
    if (name === undefined) return token === "{{" ? "{" : "}"
    const value = slots[name]
    if (value === undefined) throw new Error(`refusal template slot ${name} has no value`)
    return value
  })
}

/** A guidance sentence, rendered from its template: the one producer of that sentence. */
export function guidance(id: GuidanceId, slots: Readonly<Record<string, string>>): string {
  const text: GuidanceText = REFUSAL_TEXTS[id]
  return fill(text.guidance, slots)
}

type Guided = { readonly field: string; readonly id: GuidanceId; readonly slots: Readonly<Record<string, string>> }
// Each object whose `field` guidance() rendered, with the template and slots, out of band like a refusal's provenance.
const GUIDED = new WeakMap<object, Guided>()

/** `object` with `field` set to the guidance `id` renders, the template and slots kept for a receipt to record. */
export function withGuidance<T extends object>(
  object: T,
  field: string,
  id: GuidanceId,
  slots: Readonly<Record<string, string>>,
): T {
  const guided = { ...object, [field]: guidance(id, slots) }
  GUIDED.set(guided, { field, id, slots: { ...slots } })
  return guided
}

/** Which field of `object` guidance() rendered, with its template and slots; none for any other object. */
export function guidanceOf(object: object): Guided | undefined {
  return GUIDED.get(object)
}

/** A refusal's first answer: the one producer of its sentence. */
export function refusal(
  id: RefusalId,
  slots: Readonly<Record<string, string>> = {},
  details?: Readonly<Record<string, unknown>>,
): ThreadToolFailure {
  const text: RefusalText = REFUSAL_TEXTS[id]
  const failure = threadToolFailure(text.code, fill(text.message, slots), fill(text.next_action, slots), details)
  PROVENANCE.set(failure, { id, slots: { ...slots } })
  return failure
}

// Each failure refusal() produced, with its template id and slots: out of band, so it never serialises into an answer, and
// never recovered by parsing a sentence back (a slot value is caller input and can look like the template around it).
const PROVENANCE = new WeakMap<object, { readonly id: RefusalId; readonly slots: Readonly<Record<string, string>> }>()

/** Where `failure` came from, when refusal() produced it; a failure built any other way has none. */
export function provenanceOf(
  failure: object,
): { readonly id: RefusalId; readonly slots: Readonly<Record<string, string>> } | undefined {
  return PROVENANCE.get(failure)
}

/** `to`, carrying `from`'s provenance: for a path that rebuilds a failure as a new object (a spread drops the entry). */
export function carryProvenance<T extends object>(from: object, to: T): T {
  const known = PROVENANCE.get(from)
  if (known !== undefined) PROVENANCE.set(to, known)
  return to
}

/** `failure` with `details` merged in, keeping its provenance (a spread alone would drop it). */
function withDetails(failure: ThreadToolFailure, details: Readonly<Record<string, unknown>>): ThreadToolFailure {
  return carryProvenance(failure, { ...failure, details: { ...failure.details, ...details } })
}

/** A repeat of a refusal: its template filled again; a code with no template answers its fixed text. */
export function replayRefusal(
  code: ThreadErrorCode,
  id: RefusalId | undefined,
  slots: Readonly<Record<string, string>>,
  details?: Readonly<Record<string, unknown>>,
): ThreadToolFailure {
  if (id !== undefined) return refusal(id, slots, details)
  const fixed = FIXED_TEXT[code] ?? {
    message: `The first call under this idempotency key was refused with ${code}.`,
    next_action: "Retry with a new idempotency_key after addressing the refusal.",
  }
  return threadToolFailure(code, fixed.message, fixed.next_action, details)
}
