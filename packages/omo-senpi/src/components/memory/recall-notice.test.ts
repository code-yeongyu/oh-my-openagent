import { describe, expect, test } from "bun:test"

import type { ThemeColor } from "@code-yeongyu/senpi"

import { RECALL_CUSTOM_TYPE } from "./recall-wiring"
import { renderRecallEntry, type MemoryRecallRecord } from "./recall-notice"

const PLAIN_THEME = {
  fg: (_color: ThemeColor, text: string) => text,
  bg: (_color: "customMessageBg", text: string) => text,
}

function render(data: MemoryRecallRecord | undefined): string[] {
  const component = renderRecallEntry({ data } as never, { expanded: false }, PLAIN_THEME as never)
  expect(component).toBeDefined()
  return component!.render(120).slice(1, -1).map((line) => line.slice(1).trimEnd())
}

describe("renderRecallEntry", () => {
  test("#given surfaced recall paths #when the entry renders collapsed #then the compact title names every path", () => {
    // given
    const record: MemoryRecallRecord = { paths: ["reference/rollouts.md", "people/mina.md"] }

    // when
    const lines = render(record)

    // then
    expect(lines[0]).toContain("reference/rollouts.md")
    expect(lines[0]).toContain("people/mina.md")
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain("hint")
  })

  test("#given a record without paths #when the entry renders #then nothing is drawn", () => {
    // given / when
    const component = renderRecallEntry({ data: { paths: [] } } as never, { expanded: false }, PLAIN_THEME as never)

    // then
    expect(component).toBeUndefined()
  })

  test("#given the renderer channel #when its custom type is read #then it matches the injected recall message", () => {
    // given / when / then
    expect(RECALL_CUSTOM_TYPE).toBe("omo-memorian:recall")
  })
})
