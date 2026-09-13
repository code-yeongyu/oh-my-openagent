import { describe, expect, test } from "bun:test"

import type { ThemeColor } from "@code-yeongyu/senpi"

import { RECALL_CUSTOM_TYPE } from "./recall-wiring"
import { renderKibitzerGateEntry, renderKibitzerNudgedEntry, type KibitzerGateRecord, type KibitzerNudgedRecord } from "./kibitzer/notice"
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

describe("renderKibitzerNudgedEntry", () => {
  test("#given nudges #when rendered #then title and dim paths are shown", () => {
    const record: KibitzerNudgedRecord = { version: 1, nudges: [{ path: "memory/a.md", hint: "Use the rollout policy." }] }
    const component = renderKibitzerNudgedEntry({ data: record } as never, { expanded: false }, PLAIN_THEME as never)
    expect(component).toBeDefined()
    const lines = component!.render(120).join("\\n")
    expect(lines).toContain("✦ Kibitzer")
    expect(lines).toContain("recalled memory: Use the rollout policy.")
    expect(lines).toContain("memory/a.md")
  })

  test("#given malformed nudges #when rendered #then nothing is drawn", () => {
    expect(renderKibitzerNudgedEntry({ data: { version: 1, nudges: [] } } as never, { expanded: false }, PLAIN_THEME as never)).toBeUndefined()
    expect(renderKibitzerNudgedEntry({ data: { version: 1, nudges: [{ path: "a", hint: 4 }] } } as never, { expanded: false }, PLAIN_THEME as never)).toBeUndefined()
    expect(renderKibitzerNudgedEntry({ data: null } as never, { expanded: false }, PLAIN_THEME as never)).toBeUndefined()
  })

  test.each([
    "No stored memory clears the bar for this planning step; the transcript already contains the full methodology, QA approach, and rollout.",
    "This memory covers OAuth login prompts and remote-test helpers, not the goal continuation timer delay.",
  ])("#given a meta hint %s #when rendered #then nothing is drawn", (hint) => {
    const record = { version: 1, nudges: [{ path: "memory/a.md", hint }] }
    expect(renderKibitzerNudgedEntry({ data: record } as never, { expanded: false }, PLAIN_THEME as never)).toBeUndefined()
  })

  test.each([
    "The fix is on senpi main, not the extension.",
    "senpi monitors have a verified two-flag desync where registry.paused can remain set.",
    "The regression test does not cover Windows process cleanup.",
    "The outage is unrelated to the database migration.",
  ])("#given a factual hint %s #when rendered #then it remains renderable", (hint) => {
    const record = { version: 1, nudges: [{ path: "memory/a.md", hint }] }
    expect(renderKibitzerNudgedEntry({ data: record } as never, { expanded: false }, PLAIN_THEME as never)).toBeDefined()
  })

  test("#given a multiline hint #when rendered #then nothing is drawn", () => {
    const multiline = { version: 1, nudges: [{ path: "memory/a.md", hint: "first\nsecond" }] }
    expect(renderKibitzerNudgedEntry({ data: multiline } as never, { expanded: false }, PLAIN_THEME as never)).toBeUndefined()
  })

  test("#given a hint that normalizes to nothing or exceeds the gate budget #when rendered #then nothing is drawn", () => {
    const blank = { version: 1, nudges: [{ path: "memory/a.md", hint: "   \u001b[31m\t" }] }
    expect(renderKibitzerNudgedEntry({ data: blank } as never, { expanded: false }, PLAIN_THEME as never)).toBeUndefined()
    const overlong = { version: 1, nudges: [{ path: "memory/a.md", hint: "x".repeat(201) }] }
    expect(renderKibitzerNudgedEntry({ data: overlong } as never, { expanded: false }, PLAIN_THEME as never)).toBeUndefined()
    const atBudget = { version: 1, nudges: [{ path: "memory/a.md", hint: "y".repeat(200) }] }
    expect(renderKibitzerNudgedEntry({ data: atBudget } as never, { expanded: false }, PLAIN_THEME as never)).toBeDefined()
  })
})

describe("renderKibitzerGateEntry", () => {
  test("#given a skipped gate #when rendered #then it uses the warning notice", () => {
    const record: KibitzerGateRecord = { version: 1, status: "skipped", cause: "quick_category_unavailable", candidateCount: 2, consecutiveFailures: 3 }
    const component = renderKibitzerGateEntry({ data: record } as never, { expanded: false }, PLAIN_THEME as never)
    expect(component).toBeDefined()
    expect(component!.render(120).join("\\n")).toContain("Kibitzer gate skipped")
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
      expect(() => renderKibitzerGateEntry({ data } as never, { expanded: false }, PLAIN_THEME as never)).not.toThrow()
      expect(renderKibitzerGateEntry({ data } as never, { expanded: false }, PLAIN_THEME as never)).toBeUndefined()
    }
  })

  test("#given a dropped gate #when rendered #then nothing is drawn", () => {
    expect(renderKibitzerGateEntry({ data: { version: 1, status: "dropped", cause: "compaction", candidateCount: 1 } } as never, { expanded: false }, PLAIN_THEME as never)).toBeUndefined()
  })
})

describe("renderKibitzerGateEntry reason and runId", () => {
  const renderGate = (data: unknown, width = 120): string => {
    const component = renderKibitzerGateEntry({ data } as never, { expanded: false }, PLAIN_THEME as never)
    expect(component).toBeDefined()
    return component!.render(width).join("\\n")
  }

  test("#given a failed gate with a valid reason and runId #when rendered #then the dim reason and run lines follow the title", () => {
    const output = renderGate({ version: 1, status: "failed", cause: "child_failed", reason: "provider failed", runId: "run-123", candidateCount: 2, consecutiveFailures: 3 })
    expect(output).toContain("Kibitzer gate failed")
    expect(output).toContain("provider failed")
    expect(output).toContain("run run-123")
  })

  test("#given a failed gate whose reason is multiline, overlong or secret-like #when rendered #then the notice is drawn without the reason line", () => {
    for (const reason of ["line1\nline2", "x".repeat(161), "Authorization: Bearer sk-live-abcdefghijklmnop"]) {
      const output = renderGate({ version: 1, status: "failed", cause: "child_failed", reason, candidateCount: 2, consecutiveFailures: 3 })
      expect(output).toContain("Kibitzer gate failed")
      expect(output).not.toContain(reason)
    }
  })

  test("#given a dropped gate with a reason #when rendered #then nothing is drawn", () => {
    expect(renderKibitzerGateEntry({ data: { version: 1, status: "dropped", cause: "cancelled", reason: "why", candidateCount: 1 } } as never, { expanded: false }, PLAIN_THEME as never)).toBeUndefined()
  })

  test("#given a persistent skipped gate record without reason #when rendered #then the output includes the actionable settings hint", () => {
    const component = renderKibitzerGateEntry({ data: { version: 1, status: "skipped", cause: "quick_category_unavailable", candidateCount: 2, consecutiveFailures: 3 } } as never, { expanded: false }, PLAIN_THEME as never)
    const output = component?.render(120).join("\n")
    expect(output).toContain("Kibitzer gate skipped")
    expect(output).toContain("check Kibitzer model/provider settings")
  })

  test("#given a failed gate with an invalid reason but a valid runId #when rendered #then the title and the run line are drawn and the reason line is absent", () => {
    const output = renderGate({ version: 1, status: "failed", cause: "child_failed", reason: "line1\nline2", runId: "safe-123", candidateCount: 1, consecutiveFailures: 3 })
    expect(output).toContain("Kibitzer gate failed")
    expect(output).toContain("run safe-123")
    expect(output).not.toContain("line1")
  })

  test("#given a reason of exactly 160 characters and one of 161 #when rendered #then the first is drawn and the second is omitted", () => {
    const exact = "x".repeat(160)
    expect(renderGate({ version: 1, status: "failed", cause: "child_failed", reason: exact, candidateCount: 1, consecutiveFailures: 3 }, 300)).toContain(exact)
    expect(renderGate({ version: 1, status: "failed", cause: "child_failed", reason: "x".repeat(161), candidateCount: 1, consecutiveFailures: 3 }, 300)).not.toContain("x".repeat(161))
  })

  test("#given a reason containing CR/LF or a bearer token #when rendered #then the line is omitted while the title remains", () => {
    for (const reason of ["line1\r\nline2", "Authorization: Bearer sk-live-abcdefghijklmnop"]) {
      const output = renderGate({ version: 1, status: "failed", cause: "child_failed", reason, candidateCount: 1, consecutiveFailures: 3 })
      expect(output).toContain("Kibitzer gate failed")
      expect(output).not.toContain("line1")
      expect(output).not.toContain("Bearer")
    }
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
    expect(RECALL_CUSTOM_TYPE).toBe("omo-kibitzer:recall")
  })
})
