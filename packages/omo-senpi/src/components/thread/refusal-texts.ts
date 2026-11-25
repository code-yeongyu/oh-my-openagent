import { ADDRESS_TEXTS } from "./address/refusal-texts"
import { CONTROL_TEXTS } from "./control/refusal-texts"
import type { ThreadErrorCode } from "./errors"
import { threadToolFailure, type ThreadToolFailure } from "./errors"
import { RELAY_TEXTS } from "./remote/refusal-texts"

// The one producer of a keyed refusal's sentence (#14951, design lane ruling): each refusal is TEMPLATE DATA with named
// slots, so the same table renders the first answer, lets a receipt record which input a sentence quoted (by reference,
// never the text), and renders a repeat from the repeating call's own input, byte-equal to the first.

export type RefusalText = {
  readonly code: ThreadErrorCode
  /** `{slot}` fills a value; `{{` and `}}` are literal braces. */
  readonly message: string
  readonly next_action: string
}

export const REFUSAL_TEXTS = { ...CONTROL_TEXTS, ...ADDRESS_TEXTS, ...RELAY_TEXTS } as const
export type RefusalId = keyof typeof REFUSAL_TEXTS

/** What a repeat answers for a refusal no template produced (an engine's own message): fixed text for its code. */
export const FIXED_TEXT: Readonly<Partial<Record<ThreadErrorCode, Omit<RefusalText, "code">>>> = {}

const SLOT = /\{\{|\}\}|\{([a-z_]+)\}/g

function fill(template: string, slots: Readonly<Record<string, string>>): string {
  return template.replace(SLOT, (token, name: string | undefined) => {
    if (name === undefined) return token === "{{" ? "{" : "}"
    const value = slots[name]
    if (value === undefined) throw new Error(`refusal template slot ${name} has no value`)
    return value
  })
}

function patternOf(template: string): { readonly pattern: RegExp; readonly names: readonly string[] } {
  const names: string[] = []
  let source = ""
  let last = 0
  for (const match of template.matchAll(SLOT)) {
    source += escapeRegExp(template.slice(last, match.index))
    if (match[1] === undefined) source += escapeRegExp(match[0] === "{{" ? "{" : "}")
    else {
      names.push(match[1])
      source += "([\\s\\S]*?)"
    }
    last = (match.index ?? 0) + match[0].length
  }
  source += escapeRegExp(template.slice(last))
  return { pattern: new RegExp(`^${source}$`), names }
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** A refusal's first answer: the one producer of its sentence. */
export function refusal(
  id: RefusalId,
  slots: Readonly<Record<string, string>> = {},
  details?: Readonly<Record<string, unknown>>,
): ThreadToolFailure {
  const text: RefusalText = REFUSAL_TEXTS[id]
  return threadToolFailure(text.code, fill(text.message, slots), fill(text.next_action, slots), details)
}

/** The slots of `failure` read back through the template of its code that renders it exactly, with the template's id. */
export function readRefusal(
  failure: Pick<ThreadToolFailure, "code" | "message" | "next_action">,
): { readonly id: RefusalId; readonly slots: Readonly<Record<string, string>> } | undefined {
  for (const [id, text] of Object.entries(REFUSAL_TEXTS) as [RefusalId, RefusalText][]) {
    if (text.code !== failure.code) continue
    const slots: Record<string, string> = {}
    let matched = true
    for (const [template, said] of [
      [text.message, failure.message],
      [text.next_action, failure.next_action],
    ] as const) {
      const { pattern, names } = patternOf(template)
      const found = pattern.exec(said)
      if (found === null) {
        matched = false
        break
      }
      for (const [index, name] of names.entries()) {
        const value = found[index + 1] ?? ""
        if (slots[name] !== undefined && slots[name] !== value) matched = false
        slots[name] = value
      }
    }
    if (matched && refusalMatches(id, slots, failure)) return { id, slots }
  }
  return undefined
}

const refusalMatches = (
  id: RefusalId,
  slots: Readonly<Record<string, string>>,
  failure: Pick<ThreadToolFailure, "message" | "next_action">,
): boolean => {
  const again = refusal(id, slots)
  return again.message === failure.message && again.next_action === failure.next_action
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
