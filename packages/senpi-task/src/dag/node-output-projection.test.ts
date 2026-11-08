import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"

import {
  cleanupRoots,
  PARENT_SESSION_ID,
  startHeldRun,
  type ProjectionFixture,
} from "./node-projection.test-harness"
import { DAG_NODE_OUTPUT_PREVIEW_CHARS } from "./types"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

async function completeWith(finalResponse: string): Promise<ProjectionFixture> {
  const fixture = await startHeldRun(["only"])
  fixture.runner.child("only").settle({ status: "completed", finalResponse })
  await fixture.run
  return fixture
}

describe("dag node output projection (#8674)", () => {
  test("#given a completed node #when the checkpoint is read #then it carries the child's final text and its byte size", async () => {
    const fixture = await completeWith("the deliverable is written to profile.html")

    const node = fixture.checkpoint().nodes[0]
    expect(node?.state).toBe("completed")
    expect(node?.output).toBe("the deliverable is written to profile.html")
    expect(node?.outputBytes).toBe(Buffer.byteLength("the deliverable is written to profile.html", "utf8"))
  })

  test("#given a completed node #when the snapshot is projected #then it carries the same output as the checkpoint", async () => {
    const fixture = await completeWith("audit me")

    const node = fixture.manager.snapshot(fixture.runId, PARENT_SESSION_ID).nodes[0]
    expect(node?.output).toBe("audit me")
    expect(node?.outputBytes).toBe(8)
  })

  test("#given a child that returned no text #when the node settles #then it records outputBytes 0 instead of leaving the claim absent", async () => {
    const fixture = await completeWith("")

    const node = fixture.checkpoint().nodes[0]
    expect(node?.state).toBe("failed")
    expect(node?.output).toBe("")
    expect(node?.outputBytes).toBe(0)
  })

  test("#given an output longer than the preview budget #when it is projected #then output is bounded and outputBytes stays the full size", async () => {
    const full = "x".repeat(DAG_NODE_OUTPUT_PREVIEW_CHARS + 500)
    const fixture = await completeWith(full)

    const node = fixture.checkpoint().nodes[0]
    expect(node?.output).toHaveLength(DAG_NODE_OUTPUT_PREVIEW_CHARS)
    expect(node?.outputBytes).toBe(full.length)
  })
})
