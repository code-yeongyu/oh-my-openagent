// Shared helper for the consent corpus tests (#10488 / #10498): the message under test is the user's direct reply to a proposal.
import { resolveClaimReceipt } from "./claim"

export const source = (said: string, quote: string): string =>
  resolveClaimReceipt({ source: "user", userQuote: quote }, [{ proposal: "Shall I delete plugins X and Y?", reply: said }]).source
