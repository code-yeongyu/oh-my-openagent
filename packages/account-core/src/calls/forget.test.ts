import { describe, expect, test } from "bun:test"

import type { CustodyLog } from "./custody-log"
import { accountForget } from "./forget"

// Custody review of 09d971691e, L4 (b): the core refuses an empty device at its own boundary with one terminal record
// (security design 8.2 item 4), for a caller that reaches accountForget without the root's input check.

describe("account.forget's own boundary", () => {
  test("#given an empty device #then it is refused as empty_device with one refused record and nothing touched", async () => {
    const touched: string[] = []
    const records: string[] = []
    const custody: CustodyLog = {
      begin: async (capability) => {
        records.push(`began ${capability}`)
        return { recorded: true, end: async () => true }
      },
      refused: async (capability, code) => {
        records.push(`refused ${capability} ${code}`)
        return true
      },
    }
    const answer = await accountForget(
      {
        session: {
          forget: async () => void touched.push("session.forget"),
          update: async () => {
            touched.push("session.update")
            return undefined as never
          },
          discard: async () => void touched.push("session.discard"),
        },
        store: { clear: async () => void touched.push("store.clear") },
        custody,
      },
      { device: "" },
    )
    expect({ answer, records, touched }).toEqual({
      answer: { kind: "refused", code: "empty_device" },
      records: ["refused account.forget empty_device"],
      touched: [],
    })
  })
})
