import { describe, expect, test } from "bun:test"
import { sessionVerbLines } from "../remote-render"
import type { ThreadToolResult } from "../../omo-senpi/src/components/thread/contracts"

const interruptResult = (background: unknown): ThreadToolResult =>
  ({ kind: "ok", thread_id: "s1", interrupted: true, background }) as ThreadToolResult

describe("#13444 review: a person sees which background jobs an interrupt stopped", () => {
  test("#given an interrupt that stopped one job and failed another #when it is printed without --json #then both job ids and the failure reason are shown", () => {
    const text = sessionVerbLines(
      "interrupt",
      "b/s1",
      interruptResult({
        status: "stopped",
        stopped: [{ kind: "bash", id: "bg-1", description: "sleep 600" }],
        failed: [{ kind: "bash", id: "bg-2", reason: "process_exited" }],
      }),
    ).join("\n")
    expect(text).toContain("bg-1")
    expect(text).toContain("bg-2")
    expect(text).toContain("process_exited")
  })

  test("#given an engine that cannot stop background jobs #when it is printed #then the person is told they were left running", () => {
    const lines = sessionVerbLines("interrupt", "b/s1", interruptResult({ status: "not_supported" }))
    expect(lines.length).toBe(2)
  })

  test("#given an interrupt with no background jobs #when it is printed #then only the interrupt line is shown", () => {
    const lines = sessionVerbLines("interrupt", "b/s1", interruptResult({ status: "stopped", stopped: [], failed: [] }))
    expect(lines.length).toBe(1)
  })
})
