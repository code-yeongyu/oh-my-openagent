import { describe, expect, test } from "bun:test"

import { READ_TEXTS } from "./read-refusal-texts"
import { provenanceOf, REFUSAL_TEXTS, refusal, type RefusalId } from "./refusal-texts"

// Goldens for the read.* templates (#14951): each expected sentence is the one the transcript reader built by hand before
// the migration, with the slot values substituted.
const GOLDENS: readonly {
  readonly id: RefusalId
  readonly slots: Readonly<Record<string, string>>
  readonly message: string
  readonly next: string
}[] = [
  {
    id: "read.max_bytes_invalid",
    slots: { max_bytes: "0", cap: "1048576", default: "131072" },
    message: "max_bytes must be a positive whole number; received 0.",
    next: "Retry with max_bytes between 1 and 1048576, or omit it to take the default 131072.",
  },
  {
    id: "read.max_bytes_over_cap",
    slots: { max_bytes: "2000000", cap: "1048576", default: "131072" },
    message: "max_bytes 2000000 exceeds the 1048576-byte hard cap.",
    next: "Re-read with max_bytes at most 1048576 and follow next_cursor for the rest of the transcript.",
  },
]

describe("the read refusal templates (#14951)", () => {
  test.each(GOLDENS.map((golden) => [golden.id, golden] as const))(
    "#given %s and its slots #when refusal() renders it #then the message and next_action are the hand-built sentence, byte for byte",
    (_id, golden) => {
      const rendered = refusal(golden.id, golden.slots)
      expect(rendered.code).toBe(REFUSAL_TEXTS[golden.id].code)
      expect(rendered.message).toBe(golden.message)
      expect(rendered.next_action).toBe(golden.next)
      expect(provenanceOf(rendered)).toEqual({ id: golden.id, slots: golden.slots })
    },
  )

  test("#given every read template #when the goldens are counted #then each has one", () => {
    expect(GOLDENS.map((golden) => golden.id as string).sort()).toEqual(Object.keys(READ_TEXTS).sort())
  })
})
