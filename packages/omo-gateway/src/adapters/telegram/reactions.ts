import { GATEWAY_REACTIONS, type GatewayReaction } from "../../adapter/contract"

// Telegram bots may react only with emoji from its fixed reaction set (no keycap digits, no check
// mark), so each gateway name maps to the nearest allowed emoji; the number names have none.
const TO_EMOJI: Readonly<Partial<Record<GatewayReaction, string>>> = {
  seen: "\u{1F440}",
  working: "\u{270D}",
  done: "\u{1F44D}",
  failed: "\u{1F44E}",
  waiting: "\u{1F634}",
  question: "\u{1F914}",
}

const FROM_EMOJI: ReadonlyMap<string, GatewayReaction> = new Map(
  GATEWAY_REACTIONS.flatMap((name) => {
    const emoji = TO_EMOJI[name]
    return emoji === undefined ? [] : [[emoji, name] as const]
  }),
)

function isGatewayName(name: string): name is GatewayReaction {
  return GATEWAY_REACTIONS.some((known) => known === name)
}

export function reactionEmoji(name: string): string | null {
  if (!isGatewayName(name)) return name
  return TO_EMOJI[name] ?? null
}

export function reactionName(emoji: string): string {
  return FROM_EMOJI.get(emoji) ?? emoji
}
