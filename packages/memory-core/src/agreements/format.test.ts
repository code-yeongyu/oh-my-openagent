import { describe, expect, test } from "bun:test"

import { agreementId, parseAgreementsLedger, serializeAgreementsLedger } from "./format"
import { agreementItemsOf, renderAgreementsFile } from "./ledger-file"

describe("agreement ids and the ledger line format (storage contract)", () => {
  test("#given the same lesson with NFKC, case, whitespace and trailing punctuation variants #when ids are minted #then they are one id", () => {
    // given
    const variants = [
      "Never filter the message monitor output.",
      "never  filter the MESSAGE monitor output",
      "Never filter the message monitor output!!",
      "Ｎever filter the message monitor output",
    ]

    // when
    const ids = new Set(variants.map(agreementId))

    // then
    expect(ids.size).toBe(1)
    expect([...ids][0]).toMatch(/^[0-9a-f]{10}$/)
  })

  test("#given a canonical ledger #when parsed and serialized #then the bytes round-trip and human items sort first", () => {
    // given
    const body = [
      "- [global] Never filter the message monitor output. <!-- id: 3f9a1c0b2e; by: human; n: 3; since: 2026-10-14; last: 2026-10-21; status: needs-human -->",
      "- [project] Run bun test before claiming done. <!-- id: 7b1d000000; by: agent; n: 1; since: 2026-10-20; last: 2026-10-20; status: active -->",
    ].join("\n")

    // when
    const parsed = parseAgreementsLedger(body)

    // then
    expect(parsed.diagnostics).toEqual([])
    expect(serializeAgreementsLedger([...parsed.items].reverse())).toBe(body)
  })

  test("#given a bare line the agent appended and a malformed line #when parsed #then the bare line gets agent defaults and the malformed one is a diagnostic", () => {
    // given
    const body = "- [global] Ask before force-pushing\nnot a ledger line\n"

    // when
    const parsed = parseAgreementsLedger(body)

    // then
    expect(parsed.items).toEqual([{
      id: agreementId("Ask before force-pushing"), scope: "global", by: "agent",
      text: "Ask before force-pushing", n: 0, status: "active",
    }])
    expect(parsed.diagnostics).toHaveLength(1)
  })

  test("#given a ledger with a line the parser cannot read #when the file is rendered after a mutation #then that line is kept verbatim", () => {
    // given
    const existing = "---\ndescription: Agreements\n---\n\n- [global] Ask before force-pushing\nhand-written note the person typed\n"

    // when
    const rendered = renderAgreementsFile(existing, agreementItemsOf(existing).map((item) => ({ ...item, n: 1 })))

    // then
    expect(rendered).toContain("\nhand-written note the person typed\n")
    expect(agreementItemsOf(rendered)[0]?.n).toBe(1)
  })
})
