import { OK, type OutboundGate } from "./types"
import { dominantWritingSystem, letters, proseOf, textsOf, writingSystemShare } from "./text"

// Compares writing systems, not languages: English and Spanish are both Latin and pass each other.
// A reply follows the user when the user's writing system carries at least a quarter of it (code
// identifiers and product names are Latin in every language), or half of it for a Latin-script user.
const MIN_SHARE = 0.25
const MIN_LATIN_SHARE = 0.5

export const gate: OutboundGate = {
  id: "reply_language_follows_user",
  phase: "outbound",
  run(intent, _params, ctx) {
    const user = dominantWritingSystem(ctx.last_inbound_text ?? "")
    if (user === null) return OK
    const reply = textsOf(intent).map(proseOf).join("\n")
    if (letters(reply).length === 0) return OK
    const share = writingSystemShare(reply, user)
    if (share >= (user === "Latin" ? MIN_LATIN_SHARE : MIN_SHARE)) return OK
    return { refuse: `the user wrote in ${user} script; reply in the same language (only ${Math.round(share * 100)}% of this reply is)` }
  },
}
