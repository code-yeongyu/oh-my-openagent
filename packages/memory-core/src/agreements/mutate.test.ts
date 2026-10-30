import { describe, expect, test } from "bun:test"

import { agreementId } from "./format"
import { applyAgreementRecords } from "./mutate"
import type { AgreementItem, AgreementsPolicy } from "./types"

const POLICY: AgreementsPolicy = { needsHumanThreshold: 3, maxItems: 64 }

function item(text: string, overrides: Partial<AgreementItem> = {}): AgreementItem {
  return { id: agreementId(text), scope: "global", by: "agent", text, n: 1, since: "2026-10-01", last: "2026-10-01", status: "active", ...overrides }
}

describe("applyAgreementRecords: counting and the needs-human threshold", () => {
  test("#given an item corrected twice #when the third correction is reaffirmed #then n is 3 and it flips to needs-human exactly once", () => {
    // given
    const monitor = item("Never filter the message monitor output", { n: 2 })

    // when
    const third = applyAgreementRecords([monitor], [{ action: "reaffirm", id: monitor.id, date: "2026-10-21" }], POLICY)
    const fourth = applyAgreementRecords(third.items, [{ action: "reaffirm", id: monitor.id, date: "2026-10-22" }], POLICY)

    // then
    expect(third.items).toEqual([{ ...monitor, n: 3, last: "2026-10-21", status: "needs-human" }])
    expect(third.newlyFlagged).toEqual([monitor.id])
    expect(fourth.items[0]?.n).toBe(4)
    expect(fourth.newlyFlagged).toEqual([])
  })

  test("#given a correction the extractor reports as new #when its text matches an existing item #then the existing item is counted instead of duplicated", () => {
    // given
    const monitor = item("Never filter the message monitor output", { n: 1 })

    // when
    const result = applyAgreementRecords(
      [monitor],
      [{ action: "new", applies: "global", text: "never filter the message monitor output!", date: "2026-10-21" }],
      POLICY,
    )

    // then
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.n).toBe(2)
  })

  test("#given an agent item #when reaffirmed with stronger wording #then the text changes but the id and count history stay", () => {
    // given
    const tests = item("Run tests before claiming done", { n: 1 })

    // when
    const result = applyAgreementRecords(
      [tests],
      [{ action: "reaffirm", id: tests.id, date: "2026-10-21", text: "Always run the full test suite before claiming done" }],
      POLICY,
    )

    // then
    expect(result.items[0]).toMatchObject({ id: tests.id, n: 2, text: "Always run the full test suite before claiming done" })
  })
})

describe("applyAgreementRecords: human-written items are immutable to automation", () => {
  test("#given a human item #when automation reaffirms it with new wording and the cap evicts #then its text and scope are untouched, it is counted, and it is never evicted", () => {
    // given
    const human = item("Never filter the message monitor", { by: "human", n: 2 })
    const overlapping = item("Never filter the message monitor output stream", { n: 1, since: "2026-10-02" })
    const policy: AgreementsPolicy = { needsHumanThreshold: 3, maxItems: 2 }

    // when
    const result = applyAgreementRecords(
      [human, overlapping],
      [
        { action: "reaffirm", id: human.id, date: "2026-10-21", text: "Do whatever with the monitor" },
        { action: "new", applies: "global", text: "Never filter the monitor output", date: "2026-10-21" },
      ],
      policy,
    )

    // then
    const kept = result.items.find((entry) => entry.id === human.id)
    expect(kept).toEqual({ ...human, n: 3, last: "2026-10-21", status: "needs-human" })
    expect(result.items.filter((entry) => entry.by === "agent")).toHaveLength(1)
    expect(result.items).toHaveLength(2)
  })
})

describe("applyAgreementRecords: the cap", () => {
  test("#given a full ledger with two similar but distinct agent rules #when a new agreement arrives #then both rules survive verbatim and only the oldest unreaffirmed item is evicted, as a recorded event", () => {
    // given
    const main = item("Never push to main", { since: "2026-10-03", last: "2026-10-03" })
    const dev = item("Never push to dev", { since: "2026-10-04", last: "2026-10-04" })
    const oldest = item("Use bun, never npm", { since: "2026-10-01", last: "2026-10-01" })
    const reaffirmed = item("Answer in Korean in the chat room", { n: 2, since: "2026-09-01", last: "2026-09-01" })

    // when
    const result = applyAgreementRecords(
      [main, dev, oldest, reaffirmed],
      [{ action: "new", applies: "project", text: "Keep run roots out of tmp", date: "2026-10-21" }],
      { needsHumanThreshold: 3, maxItems: 4 },
    )

    // then
    expect(result.items.map((entry) => entry.text).sort()).toEqual(
      ["Answer in Korean in the chat room", "Keep run roots out of tmp", "Never push to dev", "Never push to main"],
    )
    expect(result.events).toEqual([{ kind: "evicted", date: "2026-10-21", item: oldest, forText: "Keep run roots out of tmp" }])
  })

  test("#given a full ledger with nothing evictable (human, reaffirmed, flagged) #when a new agreement arrives #then it is refused as a recorded event and the ledger is unchanged", () => {
    // given
    const full = [
      item("Use bun, never npm", { by: "human", n: 0 }),
      item("Answer in Korean in the chat room", { n: 2 }),
      item("Never push to main", { n: 1, status: "needs-human" }),
    ]

    // when
    const result = applyAgreementRecords(
      full,
      [{ action: "new", applies: "project", text: "Keep run roots out of tmp", date: "2026-10-21" }],
      { needsHumanThreshold: 1, maxItems: 3 },
    )

    // then
    expect([...result.items].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...full].sort((a, b) => a.id.localeCompare(b.id)))
    expect(result.events).toEqual([{ kind: "refused", date: "2026-10-21", text: "Keep run roots out of tmp" }])
    expect(result.newlyFlagged).toEqual([])
  })
})

describe("applyAgreementRecords: the cap within one batch", () => {
  test("#given a ledger one below the cap with nothing committed evictable #when one batch adds two new agreements #then the second is refused rather than evicting the first, which was never committed", () => {
    // given
    const kept = item("Answer in Korean in the chat room", { n: 2 })

    // when
    const result = applyAgreementRecords(
      [kept],
      [
        { action: "new", applies: "project", text: "Keep run roots out of tmp", date: "2026-10-21" },
        { action: "new", applies: "project", text: "Quote remote commands", date: "2026-10-21" },
      ],
      { needsHumanThreshold: 3, maxItems: 2 },
    )

    // then
    expect(result.items.map((entry) => entry.text).sort()).toEqual(["Answer in Korean in the chat room", "Keep run roots out of tmp"])
    expect(result.events).toEqual([{ kind: "refused", date: "2026-10-21", text: "Quote remote commands" }])
  })
})

describe("applyAgreementRecords: a reaffirm whose agreement was dropped meanwhile", () => {
  test("#given a reaffirm naming an id no longer in the ledger #when applied #then nothing changes and the stale reaffirm is reported as an event", () => {
    // given
    const kept = item("Use bun, never npm")

    // when
    const result = applyAgreementRecords([kept], [{ action: "reaffirm", id: "0000000000", date: "2026-10-21" }], POLICY)

    // then
    expect(result.items).toEqual([kept])
    expect(result.events).toEqual([{ kind: "stale-reaffirm", date: "2026-10-21", id: "0000000000" }])
  })
})
