import { describe, expect, test } from "bun:test"

import type { LoroDoc } from "../../crdt/loro-runtime"

import { itemFrontier, renderItem, splitItem } from "./index"
import { captureItem } from "./capture"
import { captureInto, newDoc, type Peer } from "./test-support"

// Concurrent first writes of one key tie at Lamport 0, so which kind wins is decided by
// peer order. Captures write under the device's own peer (review r3; a fresh random fork
// peer made this order, and this test, nondeterministic). Each case asserts what must
// hold for every peer order: both delivery orders render identical bytes, the
// render is valid frontmatter, re-capturing it is a zero-op fixed point, and every token
// either writer typed survives.

let mergerSerial = 100
function mergerPeer(): Peer {
  mergerSerial += 1
  return String(mergerSerial) as Peer
}

async function mergeBothOrders(textA: string, textB: string): Promise<string> {
  const docA = await newDoc("1")
  captureInto(docA, "", [], textA)
  const docB = await newDoc("2")
  captureInto(docB, "", [], textB)
  const updateA = docA.export({ mode: "update" })
  const updateB = docB.export({ mode: "update" })
  const ab = await newDoc(mergerPeer())
  ab.import(updateA)
  ab.import(updateB)
  const ba = await newDoc(mergerPeer())
  ba.import(updateB)
  ba.import(updateA)
  const rendered = renderItem(ab) ?? ""
  expect(renderItem(ba) ?? "").toBe(rendered)
  assertFixedPoint(ab, rendered)
  for (const doc of [ab, ba, docA, docB]) doc.free()
  return rendered
}

function assertFixedPoint(doc: LoroDoc, rendered: string): void {
  expect(splitItem(rendered).fm, `not valid frontmatter: ${JSON.stringify(rendered)}`).not.toBeNull()
  const again = captureItem(doc, rendered, itemFrontier(doc), rendered)
  expect(again, `re-capture is not a no-op: ${JSON.stringify(rendered)}`).toBeNull()
}

describe("concurrent frontmatter kinds (sync-design §2)", () => {
  test("string vs sequence first writes converge losslessly in both delivery orders", async () => {
    const rendered = await mergeBothOrders("---\ntags: alpha\n---\n", "---\ntags:\n  - x\n  - y\n---\n")
    for (const token of ["alpha", "x", "y"]) expect(rendered).toContain(token)
  })

  test("boolean register vs string first writes converge losslessly", async () => {
    const rendered = await mergeBothOrders("---\nflag: true\n---\n", "---\nflag: yes please\n---\n")
    for (const token of ["true", "yes please"]) expect(rendered).toContain(token)
  })

  test("joins of values that need quoting stay one valid scalar (review r1 #3)", async () => {
    const colonSeq = await mergeBothOrders("---\nk: 'a: b'\n---\n", "---\nk:\n  - z\n---\n")
    for (const token of ["a: b", "z"]) expect(colonSeq).toContain(token)
    const colonReg = await mergeBothOrders("---\nflag: true\n---\n", "---\nflag: 'q: r'\n---\n")
    for (const token of ["q: r", "true"]) expect(colonReg).toContain(token)
  })

  test("multiline values survive a concurrent kind merge as valid YAML", async () => {
    const rendered = await mergeBothOrders("---\nk: |\n  l1\n  l2\n---\n", "---\nk:\n  - z\n---\n")
    for (const token of ["l1", "l2", "z"]) expect(rendered).toContain(token)
  })
})
