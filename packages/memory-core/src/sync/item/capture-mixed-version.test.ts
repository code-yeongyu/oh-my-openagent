import { describe, expect, test } from "bun:test"

import type { LoroDoc } from "../../crdt/loro-runtime"

import { captureItem } from "./capture"
import { itemFrontier, renderItem } from "./index"
import { captureInto, newDoc } from "./test-support"

// PR #12295 review: while any member of the account runs a build older than #12279, this device
// captures with the character diff, so a mixed account converges to exactly the bytes two old
// devices would produce. The old device is the pre-#12279 capture (capture.ts:110 on dev b5fd542ba4),
// a character diff on the body; the expected bytes come from two such old devices, never from the
// code under test. A line diff here corrupts a third line nobody edited.

const HDR = "---\ndescription: mixed version\n---\n"

type Role = "old" | "new"

const CASES: readonly (readonly [name: string, base: string, a: string, b: string])[] = [
  ["Monday -> Tuesday / Thursday", "the meeting moved to Monday\nkeep me\n", "the meeting moved to Tuesday\nkeep me\n", "the meeting moved to Thursday\nkeep me\n"],
  ["SAME-LINE version A / B", "line from m13-a EDITED-ON-A\nline two\n", "SAME-LINE version A\nline two\n", "SAME-LINE version B\nline two\n"],
  ["alpha FIRST / LAST", "alpha beta gamma\nnext line\n", "alpha FIRST beta gamma\nnext line\n", "alpha beta gamma LAST\nnext line\n"],
  ["one-line body, same line", "only line\n", "only line by A\n", "only line by B\n"],
]

/** The pre-#12279 capture of a body edit: a character diff, under the doc's own peer. */
function oldCapture(doc: LoroDoc, body: string): Uint8Array {
  const fork = doc.fork()
  try {
    fork.setPeerId(doc.peerId)
    fork.setRecordTimestamp(false)
    fork.getText("body").update(body)
    fork.commit()
    return fork.export({ mode: "update", from: doc.oplogVersion() })
  } finally {
    fork.free()
  }
}

async function merged(roles: readonly [Role, Role], base: string, a: string, b: string, aFirst: boolean): Promise<string[]> {
  const docA = await newDoc("1")
  const docB = await newDoc("2")
  captureInto(docA, "", [], `${HDR}${base}`)
  docB.import(docA.export({ mode: "update" }))
  const text = renderItem(docA) ?? ""
  const f1 = itemFrontier(docA)
  const edit = (doc: LoroDoc, role: Role, body: string): Uint8Array => {
    if (role === "old") return oldCapture(doc, body)
    const update = captureItem(doc, text, f1, `${HDR}${body}`, "char")
    if (update === null) throw new Error("capture produced no update")
    return update
  }
  const updA = edit(docA, roles[0], a)
  const updB = edit(docB, roles[1], b)
  const order = aFirst ? [updA, updB] : [updB, updA]
  for (const doc of [docA, docB]) for (const update of order) doc.import(update)
  const out = [renderItem(docA) ?? "", renderItem(docB) ?? ""]
  docA.free()
  docB.free()
  return out
}

describe("mixed-version account: the merge is exactly the old+old merge (PR #12295)", () => {
  for (const [name, base, a, b] of CASES) {
    for (const roles of [["old", "new"], ["new", "old"]] as const) {
      for (const aFirst of [true, false]) {
        test(`${name}: A ${roles[0]}, B ${roles[1]}, ${aFirst ? "A then B" : "B then A"}`, async () => {
          const [want] = await merged(["old", "old"], base, a, b, aFirst)
          const [onA, onB] = await merged(roles, base, a, b, aFirst)
          expect(onA).toBe(onB)
          expect(onA).toBe(want)
        })
      }
    }
  }
})
