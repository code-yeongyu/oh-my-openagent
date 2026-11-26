import { guidance, type GuidanceId } from "../refusal-texts"

type Guidance = { readonly id: GuidanceId; readonly slots: Readonly<Record<string, string>> }

/**
 * The delivery a repeated create reports for its first prompt: the recorded one (slice D1, #14941, changes this one
 * function to ask the holder for the prompt's current kind).
 */
function repeatedPromptKind(recorded: Readonly<Record<string, unknown>>): unknown {
  return recorded["delivery"]
}

/** The do-not-resend guidance of a prompt its thread holds until it wakes; none for any other delivery. */
export function queuedPromptGuidance(
  delivery: unknown,
  thread: string,
  device: string | undefined,
): Guidance | undefined {
  const { kind, waiting_on } = (delivery ?? {}) as {
    readonly kind?: unknown
    readonly waiting_on?: { readonly kind?: unknown }
  }
  if (kind !== "queued" || waiting_on?.kind !== "wake") return undefined
  return device === undefined
    ? { id: "control.create_prompt_queued_next", slots: { thread } }
    : { id: "control.create_prompt_queued_next_on_device", slots: { thread, device } }
}

/** A repeat's guidance for `id`, rendered again only while the prompt's kind still calls for it. */
export function repeatedGuidance(
  id: GuidanceId,
  slots: Readonly<Record<string, string>>,
  recorded: Readonly<Record<string, unknown>>,
): string | undefined {
  const again = queuedPromptGuidance(repeatedPromptKind(recorded), slots["thread"] ?? "", slots["device"])
  return again?.id === id ? guidance(id, slots) : undefined
}
