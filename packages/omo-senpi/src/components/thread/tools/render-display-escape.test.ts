import { describe, expect, test } from "bun:test"

import { DISPLAY_UNSAFE, unsafeCodeUnits } from "@oh-my-opencode/utils/testing/display-unsafe"
import type { Theme, ThemeColor } from "@code-yeongyu/senpi"
import { renderThreadResult } from "./render"

const PLAIN = { fg: (_color: ThemeColor, text: string) => text, bold: (text: string) => text } as unknown as Theme

const listResult = (value: string) => ({
  kind: "ok",
  scope: "all",
  threads: [
    {
      thread: value,
      name: value,
      status: "live",
      state: "idle",
      cwd: value,
      created_at: "2026-11-25T00:00:00Z",
      updated_at: null,
      machine: value,
    },
  ],
})

function shown(result: unknown, expanded: boolean): string[] {
  const output = { content: [{ type: "text", text: JSON.stringify(result) }], details: { result } }
  const component = renderThreadResult("thread_list")(output as never, { expanded, isPartial: false } as never, PLAIN, {
    args: {},
  }) as unknown as { render: (width: number) => string[] }
  return component.render(400)
}

describe("the thread tool result shown to a person", () => {
  test("#given a result holding each fixture #when shown collapsed and expanded #then no shown line holds an unsafe unit, and the result object is unchanged", () => {
    for (const fixture of DISPLAY_UNSAFE) {
      const result = listResult(fixture)
      const before = JSON.stringify(result)
      for (const expanded of [false, true])
        for (const line of shown(result, expanded))
          expect({ fixture, units: unsafeCodeUnits(line) }).toEqual({ fixture, units: [] })
      expect(JSON.stringify(result)).toBe(before)
    }
  })
})
