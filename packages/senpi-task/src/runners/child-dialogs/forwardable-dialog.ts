import type { RpcExtensionUIResponse } from "@code-yeongyu/senpi"

/**
 * A child dialog the parent's UI may answer (#6189 F2d): the four prompting methods, never a secret input or a
 * permanent grant selection (those stay with the raiser and keep the auto-cancel, so a secret never travels).
 */
export type ForwardableDialog =
  | { readonly method: "select"; readonly title: string; readonly options: readonly string[]; readonly toolCallId?: string; readonly parentToolCallId?: string; readonly timeout?: number }
  | { readonly method: "confirm"; readonly title: string; readonly message: string; readonly timeout?: number }
  | { readonly method: "input"; readonly title: string; readonly placeholder?: string; readonly toolCallId?: string; readonly parentToolCallId?: string; readonly timeout?: number }
  | { readonly method: "editor"; readonly title: string; readonly prefill?: string }

export type ForwardedAnswer =
  | { readonly kind: "value"; readonly value: string }
  | { readonly kind: "confirmed"; readonly confirmed: boolean }
  | { readonly kind: "cancelled" }

export const CANCELLED: ForwardedAnswer = { kind: "cancelled" }

type Frame = Readonly<Record<string, unknown>>

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)
const positive = (value: unknown): number | undefined => (typeof value === "number" && value > 0 ? value : undefined)

function optional<K extends string, V>(key: K, value: V | undefined): { readonly [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { readonly [P in K]?: V }
}

/** Parses a child's `extension_ui_request` frame; undefined for a method that is not forwarded or a raiser-only kind. */
export function forwardableDialogOf(frame: Frame): ForwardableDialog | undefined {
  if (frame["secret"] === true || frame["grantSelect"] === true) return undefined
  const title = text(frame["title"])
  if (title === undefined) return undefined
  const timeout = optional("timeout", positive(frame["timeout"]))
  const toolCallId = { ...optional("toolCallId", text(frame["toolCallId"])), ...optional("parentToolCallId", text(frame["parentToolCallId"])) }
  switch (frame["method"]) {
    case "select": {
      const options = frame["options"]
      if (!Array.isArray(options) || !options.every((option) => typeof option === "string")) return undefined
      return { method: "select", title, options, ...toolCallId, ...timeout }
    }
    case "confirm": {
      const message = text(frame["message"])
      return message === undefined ? undefined : { method: "confirm", title, message, ...timeout }
    }
    case "input":
      return { method: "input", title, ...optional("placeholder", text(frame["placeholder"])), ...toolCallId, ...timeout }
    case "editor":
      return { method: "editor", title, ...optional("prefill", text(frame["prefill"])) }
    default:
      return undefined
  }
}

export function forwardedUiResponse(id: string, answer: ForwardedAnswer): RpcExtensionUIResponse {
  switch (answer.kind) {
    case "value":
      return { type: "extension_ui_response", id, value: answer.value }
    case "confirmed":
      return { type: "extension_ui_response", id, confirmed: answer.confirmed }
    case "cancelled":
      return { type: "extension_ui_response", id, cancelled: true }
  }
}
