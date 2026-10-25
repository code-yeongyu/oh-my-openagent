import { describe, expect, test } from "bun:test"

import {
  claimReceiptTrailers,
  parseClaimReceipt,
  proposalId,
  renderClaimReceipt,
  resolveClaimReceipt,
  USER_QUOTE_RULE,
} from "./claim"

const PROPOSAL = "I suggest removing plugins X and Y."
const USER_TEXTS = [
  { proposal: "What should I look at?", reply: "Please look at the WordPress plugins and tell me which ones look unused." },
  { proposal: PROPOSAL, reply: "Yes delete it!" },
]

describe("claim receipts", () => {
  test("#given a user claim quoting a whole consent message #when resolved #then it keeps the user source and the message as written", () => {
    expect(resolveClaimReceipt({ source: "user", userQuote: "yes delete it" }, USER_TEXTS)).toEqual({ source: "user", userQuote: "Yes delete it!", approves: proposalId(PROPOSAL) })
  })

  test("#given the #10488 flip: a user claim quoting the agent's own suggestion #when resolved #then it is downgraded to an agent suggestion", () => {
    expect(resolveClaimReceipt({ source: "user", userQuote: "remove plugins X and Y" }, USER_TEXTS)).toEqual({ source: "agent", downgraded: true })
  })

  test("#given a whole user message that is not a listed consent phrase #when resolved #then it stays a suggestion", () => {
    expect(resolveClaimReceipt({ source: "user", userQuote: USER_TEXTS[0]?.reply }, USER_TEXTS)).toEqual({ source: "agent", downgraded: true })
  })

  test("#given a listed phrase the user never sent #when resolved #then it is downgraded", () => {
    expect(resolveClaimReceipt({ source: "user", userQuote: "go ahead" }, USER_TEXTS)).toEqual({ source: "agent", downgraded: true })
  })

  test("#given a user claim with no quote #when resolved #then it is downgraded", () => {
    expect(resolveClaimReceipt({ source: "user" }, USER_TEXTS)).toEqual({ source: "agent", downgraded: true })
  })

  test("#given a quote that differs only in spacing and case #when resolved #then it still matches", () => {
    expect(resolveClaimReceipt({ source: "user", userQuote: "  YES   delete IT " }, USER_TEXTS).source).toBe("user")
  })

  test("#given an agent or inferred claim #when resolved #then the source is kept and any quote is dropped", () => {
    expect(resolveClaimReceipt({ source: "agent", userQuote: "yes delete it" }, USER_TEXTS)).toEqual({ source: "agent" })
    expect(resolveClaimReceipt({ source: "inferred" }, USER_TEXTS)).toEqual({ source: "inferred" })
  })

  test("#given a missing or unknown source #when resolved #then it is inferred", () => {
    expect(resolveClaimReceipt({}, USER_TEXTS)).toEqual({ source: "inferred" })
    expect(resolveClaimReceipt({ source: "boss" }, USER_TEXTS)).toEqual({ source: "inferred" })
  })

  test("#given each receipt #when rendered as trailers #then source, quote and downgrade are single-line trailers", () => {
    expect(claimReceiptTrailers({ source: "user", userQuote: "a\nb", approves: "0123456789abcdef" })).toEqual([
      "Omo-Claim-Source: user",
      "Omo-User-Quote: a b",
      "Omo-Claim-Approves: 0123456789abcdef",
    ])
    expect(claimReceiptTrailers({ source: "agent", downgraded: true })).toEqual([
      "Omo-Claim-Source: agent",
      "Omo-Claim-Downgraded: unverified-user-quote",
    ])
  })

  test("#given the facts extractor persona #when shipped #then it states the same user_quote rule the verifier enforces", async () => {
    const persona = await Bun.file(new URL("../facts/assets/facts-persona.md", import.meta.url)).text()
    expect(persona).toContain(USER_QUOTE_RULE)
  })
  test("#given a user receipt #when rendered and parsed #then it names the approved proposal, and one without a valid proposal id is rejected", () => {
    const receipt = { source: "user", userQuote: "ok", approves: proposalId(PROPOSAL) } as const
    expect(renderClaimReceipt(receipt)).toBe(`user replied "ok" to proposal ${proposalId(PROPOSAL)}; a record, not the user's approval`)
    expect(parseClaimReceipt(receipt)).toEqual(receipt)
    expect(parseClaimReceipt({ source: "user", userQuote: "ok" })).toBeUndefined()
    expect(parseClaimReceipt({ source: "user", userQuote: "ok", approves: "not-a-hash" })).toBeUndefined()
  })

  test("#given a proposal #when its id is computed #then whitespace differences do not change it", () => {
    expect(proposalId("  I suggest\nremoving plugins X and Y. ")).toBe(proposalId(PROPOSAL))
    expect(proposalId(PROPOSAL)).toMatch(/^[0-9a-f]{16}$/u)
  })
})
