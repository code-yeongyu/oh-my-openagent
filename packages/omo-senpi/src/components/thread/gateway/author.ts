import type { ExternalAuthor, StoreRefusal } from "./types"

export const AUTHOR_ID_MAX_LENGTH = 256
export const AUTHOR_DISPLAY_MAX_LENGTH = 256

// C0 and C1 controls, DEL, and the Unicode line and paragraph separators: any of them could break the
// one-line provenance header the author is rendered into.
// biome-ignore lint/suspicious/noControlCharactersInRegex: author fields are rejected when they carry control characters.
const LINE_BREAKING = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/

function refusal(message: string): StoreRefusal {
  return { kind: "refused", code: "invalid_arguments", message }
}

function field(name: string, value: unknown, max: number): string | StoreRefusal {
  if (typeof value !== "string" || value.trim().length === 0) return refusal(`author.${name} must be a non-empty string.`)
  if (value.length > max) return refusal(`author.${name} is longer than ${max} characters.`)
  if (LINE_BREAKING.test(value)) return refusal(`author.${name} carries a control character or line break.`)
  return value.trim()
}

/** The author a connector named, trimmed, or `invalid_arguments` when a field is empty, too long, or not one line. */
export function normalizeAuthor(input: ExternalAuthor): ExternalAuthor | StoreRefusal {
  const platformUserId = field("platform_user_id", input.platform_user_id, AUTHOR_ID_MAX_LENGTH)
  if (typeof platformUserId !== "string") return platformUserId
  const display = field("display", input.display, AUTHOR_DISPLAY_MAX_LENGTH)
  if (typeof display !== "string") return display
  if (input.user_id === undefined) return { platform_user_id: platformUserId, display }
  const userId = field("user_id", input.user_id, AUTHOR_ID_MAX_LENGTH)
  if (typeof userId !== "string") return userId
  return { platform_user_id: platformUserId, display, user_id: userId }
}
