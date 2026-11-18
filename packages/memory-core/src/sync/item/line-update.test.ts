import { describe, expect, spyOn, test } from "bun:test"

import { updateBodyText } from "./line-update"
import { newDoc } from "./test-support"

// #12526 (review of #12295): past MAX_EDITS (2,000) inserted plus deleted lines the Myers line script gives
// up and the body falls back to the character merge (`text.update`). These pin the bound on both sides and
// check that a concurrent edit on another device still merges on the fallback path.

const lines = (prefix: string, count: number): string =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index}\n`).join("")

async function bodyDoc(peer: `${number}`, body: string) {
  const doc = await newDoc(peer)
  doc.getText("body").insert(0, body)
  doc.commit()
  return doc
}

describe("body line update edit bound (#12526)", () => {
  test("#given a target 2,000 inserted lines away #when the body is updated #then the line script runs and the character merge does not", async () => {
    // given
    const doc = await bodyDoc("1", "head\n")
    const text = doc.getText("body")
    const target = `head\n${lines("added", 2_000)}`
    const merge = spyOn(text, "update")
    const insert = spyOn(text, "insert")

    // when
    updateBodyText(text, target)

    // then
    expect(merge).not.toHaveBeenCalled()
    expect(insert).toHaveBeenCalled()
    expect(text.toString()).toBe(target)
  })

  test("#given a target 2,001 inserted lines away #when the body is updated #then it falls back to the character merge", async () => {
    // given
    const doc = await bodyDoc("1", "head\n")
    const text = doc.getText("body")
    const target = `head\n${lines("added", 2_001)}`
    const merge = spyOn(text, "update")

    // when
    updateBodyText(text, target)

    // then
    expect(merge).toHaveBeenCalledTimes(1)
    expect(merge).toHaveBeenCalledWith(target)
    expect(text.toString()).toBe(target)
  })

  test("#given one device rewrites more than 2,000 lines while another edits the first line #when both merge #then the character fallback converges, keeps both edits' text and revives no old line", async () => {
    // given: one shared base on two devices
    const base = `title\n${lines("old", 1_200)}`
    const deviceA = await bodyDoc("1", base)
    const deviceB = await newDoc("2")
    deviceB.import(deviceA.export({ mode: "update" }))

    // when: A replaces all 1,200 body lines (2,400 edits, past the bound); B edits only the title line
    const rewritten = `title\n${lines("new", 1_200)}`
    const textA = deviceA.getText("body")
    const merge = spyOn(textA, "update")
    updateBodyText(textA, rewritten)
    deviceA.commit()
    updateBodyText(deviceB.getText("body"), base.replace("title\n", "title edited on B\n"))
    deviceB.commit()
    deviceA.import(deviceB.export({ mode: "update" }))
    deviceB.import(deviceA.export({ mode: "update" }))

    // then: the character merge (the pre-#12279 behavior) keeps every character of both edits but, unlike the line
    // ops, need not keep B's line where it was: B's whole edited line lands somewhere inside A's rewritten text.
    expect(merge).toHaveBeenCalledTimes(1)
    const merged = deviceA.getText("body").toString()
    expect(deviceB.getText("body").toString()).toBe(merged)
    expect(merged).toContain("title edited on B\n")
    expect(merged.replace("title edited on B\n", "")).toBe(lines("new", 1_200))
    expect(merged).not.toContain("old ")
  })
})
