import { describe, expect, test } from "bun:test"

import { createChildProgress, readToolProgressDetails } from "./progress"

describe("child task progress", () => {
  test("#given child events #when progress is composed #then it exposes stable live status details", () => {
    const progress = createChildProgress("st_00000001", "quick", 1_000)

    progress.accept({ type: "tool_execution_start", toolName: "read", args: { path: "src/foo.ts" } })
    progress.accept({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "First line\nFinal assistant update" }] },
    })

    const details = progress.details()
    expect(details).toEqual({
      progress: { activity: "running read src/foo.ts", startedAt: 1_000 },
      childId: "st_00000001",
      currentTool: "read src/foo.ts",
      lastAssistantLine: "Final assistant update",
      turns: 1,
    })
    expect(progress.text(43_000)).toBe("⏵ st_00000001 · quick · turn 1 · running read src/foo.ts · 42s\n↳ last: Final assistant update")
  })

  test("#given unknown details #when read #then only the local progress shape is accepted", () => {
    expect(readToolProgressDetails({ progress: { activity: "queued", startedAt: 1 }, childId: "st_1", turns: 0 })).toEqual({
      progress: { activity: "queued", startedAt: 1 },
      childId: "st_1",
      turns: 0,
    })
    expect(readToolProgressDetails({ progress: { startedAt: "1" }, childId: "st_1", turns: 0 })).toBeUndefined()
  })
})
