import { describe, expect, test } from "bun:test"

import type { ThemeColor } from "@code-yeongyu/senpi"

import { RECALL_CUSTOM_TYPE } from "./recall-wiring"
import { renderMemorianGateEntry, renderMemorianNudgedEntry, type MemorianGateRecord, type MemorianNudgedRecord } from "./memorian-notice"
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

describe("renderMemorianNudgedEntry", () => {
  test("#given nudges #when rendered #then title and dim paths are shown", () => {
    const record: MemorianNudgedRecord = { version: 1, nudges: [{ path: "memory/a.md", hint: "Use the rollout policy." }] }
    const component = renderMemorianNudgedEntry({ data: record } as never, { expanded: false }, PLAIN_THEME as never)
    expect(component).toBeDefined()
    const lines = component!.render(120).join("\\n")
    expect(lines).toContain("Memorian nudged")
    expect(lines).toContain("Use the rollout policy.")
    expect(lines).toContain("memory/a.md")
  })

  test("#given malformed nudges #when rendered #then nothing is drawn", () => {
    expect(renderMemorianNudgedEntry({ data: { version: 1, nudges: [] } } as never, { expanded: false }, PLAIN_THEME as never)).toBeUndefined()
    expect(renderMemorianNudgedEntry({ data: { version: 1, nudges: [{ path: "a", hint: 4 }] } } as never, { expanded: false }, PLAIN_THEME as never)).toBeUndefined()
    expect(renderMemorianNudgedEntry({ data: null } as never, { expanded: false }, PLAIN_THEME as never)).toBeUndefined()
  })

  test("#given a hint that normalizes to nothing or exceeds the gate budget #when rendered #then nothing is drawn", () => {
    const blank = { version: 1, nudges: [{ path: "memory/a.md", hint: "   \u001b[31m\t" }] }
    expect(renderMemorianNudgedEntry({ data: blank } as never, { expanded: false }, PLAIN_THEME as never)).toBeUndefined()
    const overlong = { version: 1, nudges: [{ path: "memory/a.md", hint: "x".repeat(201) }] }
    expect(renderMemorianNudgedEntry({ data: overlong } as never, { expanded: false }, PLAIN_THEME as never)).toBeUndefined()
    const atBudget = { version: 1, nudges: [{ path: "memory/a.md", hint: "y".repeat(200) }] }
    expect(renderMemorianNudgedEntry({ data: atBudget } as never, { expanded: false }, PLAIN_THEME as never)).toBeDefined()
  })
})

describe("renderMemorianGateEntry", () => {
  test("#given a skipped gate #when rendered #then it uses the warning notice", () => {
    const record: MemorianGateRecord = { version: 1, status: "skipped", cause: "quick_category_unavailable", candidateCount: 2 }
    const component = renderMemorianGateEntry({ data: record } as never, { expanded: false }, PLAIN_THEME as never)
    expect(component).toBeDefined()
    expect(component!.render(120).join("\\n")).toContain("Memorian gate skipped")
  })

  test("#given a null or count-malformed gate record #when rendered #then nothing is drawn and nothing throws", () => {
    for (const data of [
      null,
      { version: 1, status: "skipped", cause: "x" },
      { version: 1, status: "skipped", cause: "x", candidateCount: "2" },
      { version: 1, status: "skipped", cause: "x", candidateCount: Number.NaN },
      { version: 1, status: "skipped", cause: "x", candidateCount: Number.POSITIVE_INFINITY },
      { version: 1, status: "skipped", cause: "x", candidateCount: 1.5 },
      { version: 1, status: "failed", cause: "x", candidateCount: -1 },
    ]) {
      expect(() => renderMemorianGateEntry({ data } as never, { expanded: false }, PLAIN_THEME as never)).not.toThrow()
      expect(renderMemorianGateEntry({ data } as never, { expanded: false }, PLAIN_THEME as never)).toBeUndefined()
    }
  })

  test("#given a dropped gate #when rendered #then nothing is drawn", () => {
    expect(renderMemorianGateEntry({ data: { version: 1, status: "dropped", cause: "compaction", candidateCount: 1 } } as never, { expanded: false }, PLAIN_THEME as never)).toBeUndefined()
  })
})

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
