// The closed set of user messages that auto-verify as consent (#10488, lead's final design on #10498). Meaning, not
// characters, was the remaining hole: no list of hedges, questions or retractions is ever complete. So a user message
// backs a "user said" receipt only when, after the character allowlist in claim.ts, the whole message is EXACTLY one of
// these explicit affirmative phrases (case and spacing folded, one optional final '.' or '!'). Anything else, however
// reasonable it reads, is not auto-verified: the claim is stored as an agent suggestion and the user confirms in the session.
// A false "not verified" costs one confirmation; a false "user said" is the incident this guards against.
export const CONSENT_PHRASES = {
  ko: ["응", "네", "예", "좋아", "그래", "지워", "지워줘", "삭제해", "삭제해줘", "진행해"],
  en: ["yes", "ok", "okay", "do it", "go ahead", "delete it", "yes delete it"],
} as const satisfies Readonly<Record<string, readonly string[]>>

const PHRASES: ReadonlySet<string> = new Set(Object.values(CONSENT_PHRASES).flat())

// `phrase` is already case-folded and space-collapsed, with the optional final mark removed.
export function isConsentPhrase(phrase: string): boolean {
  return PHRASES.has(phrase)
}
