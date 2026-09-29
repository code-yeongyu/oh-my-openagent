/**
 * The extension UI request kinds a relayed question can name (senpi `ctx.ui.question` / `select` /
 * `confirm` / `input` / `editor`), and how one answer text becomes the `extension_ui_response`
 * fields that kind reads. The session declares the kind when it reports the question. A question
 * reported without one (`null`, also every row written before kinds were recorded) gets the text in
 * every text shape at once (`value` + `answers: {}` + `comment`), so a question, select, input or
 * editor each reads its own field; a confirm reads only `confirmed`, so a confirm must be declared.
 */
export const UI_REQUEST_KINDS = ["question", "select", "confirm", "input", "editor"] as const
export type UiRequestKind = (typeof UI_REQUEST_KINDS)[number]

export function isUiRequestKind(value: unknown): value is UiRequestKind {
  return typeof value === "string" && (UI_REQUEST_KINDS as readonly string[]).includes(value)
}

export type AnswerFields =
  | { readonly value: string }
  | { readonly confirmed: boolean }
  | { readonly answers: Readonly<Record<string, never>>; readonly comment: string }
  | { readonly value: string; readonly answers: Readonly<Record<string, never>>; readonly comment: string }

export type AnswerShape = { readonly ok: true; readonly fields: AnswerFields } | { readonly ok: false; readonly reason: string }

const CONFIRM_ANSWERS: ReadonlyMap<string, boolean> = new Map([
  ["yes", true], ["y", true], ["true", true],
  ["no", false], ["n", false], ["false", false],
])

/** Nothing but whitespace and invisible format characters (zero-width space, joiners, BOM, soft hyphen). */
export function isBlankAnswer(text: string): boolean {
  return text.replace(/[\s\p{Cf}]/gu, "") === ""
}

export function answerShape(kind: UiRequestKind | null, text: string): AnswerShape {
  switch (kind) {
    case null:
      return isBlankAnswer(text)
        ? { ok: false, reason: "The question declared no request kind, so the answer needs text; this one is blank. An input or editor that takes an empty answer must be reported with its request kind." }
        : { ok: true, fields: { value: text, answers: {}, comment: text } }
    case "input":
    case "editor":
      return { ok: true, fields: { value: text } }
    case "select":
      return isBlankAnswer(text) ? { ok: false, reason: "A select answer names one of its options; the text is blank." } : { ok: true, fields: { value: text } }
    case "question":
      return isBlankAnswer(text) ? { ok: false, reason: "A question answer needs text; this one is blank." } : { ok: true, fields: { answers: {}, comment: text } }
    case "confirm": {
      const confirmed = CONFIRM_ANSWERS.get(text.trim().toLowerCase())
      return confirmed === undefined ? { ok: false, reason: "A confirm answer is yes or no (also y/n, true/false; any case, surrounding spaces ignored)." } : { ok: true, fields: { confirmed } }
    }
    default:
      return assertNever(kind)
  }
}

function assertNever(value: never): never {
  throw new Error(`unknown extension UI request kind: ${String(value)}`)
}
