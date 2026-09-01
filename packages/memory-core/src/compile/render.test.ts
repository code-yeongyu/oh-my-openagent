import { describe, expect, it } from "bun:test"
import { markMemoryBlock, replaceMemoryBlock, stripMemoryBlock } from "./render"

describe("memory block sentinels", () => {
  it("#given an identity and block #when marked #then the exact sentinel wrapper is returned", () => {
    // given / when
    const marked = markMemoryBlock("agent-1", "compiled")

    // then
    expect(marked).toBe("<!-- senpi-memory:agent-1:begin -->\ncompiled\n<!-- senpi-memory:agent-1:end -->")
  })

  it("#given repeated legacy blocks #when replaced #then every matching region is transformed", () => {
    // given
    const old = markMemoryBlock("agent-1", "old")
    const replacement = markMemoryBlock("agent-1", "new")
    const prompt = `before\n${old}\nmiddle\n${old}\nafter`

    // when
    const result = replaceMemoryBlock(prompt, replacement)

    // then
    expect(result).toBe(`before\n${replacement}\nmiddle\n${replacement}\nafter`)
  })

  it("#given no matching block #when replaced #then the sentinel block is appended", () => {
    // given / when
    const replacement = markMemoryBlock("agent-1", "new")
    const result = replaceMemoryBlock("base prompt\n", replacement)

    // then
    expect(result).toBe(`base prompt\n\n${replacement}`)
  })

  it("#given marked regions #when stripped #then only surrounding prompt content remains", () => {
    // given
    const prompt = `base\n\n${markMemoryBlock("one", "first")}\n\n${markMemoryBlock("two", "second")}`

    // when / then
    expect(stripMemoryBlock(prompt)).toBe("base")
  })
})
