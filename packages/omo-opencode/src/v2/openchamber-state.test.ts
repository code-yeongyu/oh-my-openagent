import { describe, expect, test } from "bun:test"

import { publishOpenChamberState } from "./openchamber-state"

describe("OpenChamber state bridge", () => {
  test("publishes toasts and one work status row", async () => {
    const toasts: Array<{ kind: string; message: string }> = []
    const sections: Array<{ title: string; body: string }> = []
    const result = await publishOpenChamberState({
      host: {
        toast(input) {
          toasts.push(input)
        },
        section(input) {
          sections.push(input)
        },
        async listSessions() {
          return [{ id: "ses_1", title: "Demo" }]
        },
      },
      async readFile(path) {
        if (path.endsWith("toasts.json")) return JSON.stringify([{ title: "OhMyOpenCode", message: "ready", variant: "success" }])
        return JSON.stringify({ ses_1: [{ content: "ship the adapter", status: "pending" }] })
      },
    })
    expect(toasts).toEqual([{ kind: "success", message: "OhMyOpenCode: ready" }])
    expect(sections[0]).toEqual({ title: "Work Status", body: "ses_1: ship the adapter (pending)" })
    expect(result.sessions).toEqual([{ id: "ses_1", title: "Demo" }])
    expect(result.rows).toHaveLength(1)
  })
})
