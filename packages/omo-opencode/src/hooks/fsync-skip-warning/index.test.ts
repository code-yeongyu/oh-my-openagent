import { beforeEach, describe, expect, it } from "bun:test"

import { classifyPathEnvironment } from "../../shared/classify-path-environment"
import { clearAllSkips, recordFsyncSkip } from "../../shared/fsync-skip-tracker"
import { createFsyncSkipWarningHook } from "./index"

describe("createFsyncSkipWarningHook", () => {
  beforeEach(() => {
    clearAllSkips()
  })

  it("records callID start timestamp in tool.execute.before", async () => {
    const hook = createFsyncSkipWarningHook()
    const input = { tool: "bash", sessionID: "ses1", callID: "call-1" }
    const output = { args: {} as Record<string, unknown> }

    await hook["tool.execute.before"](input, output)
    await Bun.sleep(2)

    recordFsyncSkip({
      filePath: "/tmp/a",
      contextLabel: "atomicWrite:/tmp/a",
      errorCode: "EPERM",
      message: "operation not permitted",
      pathClassification: classifyPathEnvironment("/tmp/a"),
    })

    const afterOutput = { title: "ok", output: "done", metadata: {} as Record<string, unknown> }
    await hook["tool.execute.after"](input, afterOutput)

    expect(afterOutput.output).toContain("[fsync-skipped]")
  })

  it("drains skips after start time and appends warning to output text", async () => {
    const hook = createFsyncSkipWarningHook()
    const input = { tool: "write", sessionID: "ses1", callID: "call-2" }
    const beforeOutput = { args: {} as Record<string, unknown> }
    const afterOutput = { title: "ok", output: "base", metadata: {} as Record<string, unknown> }

    await hook["tool.execute.before"](input, beforeOutput)
    await Bun.sleep(2)

    recordFsyncSkip({
      filePath: "/Users/x/OneDrive/a",
      contextLabel: "atomicWrite:/Users/x/OneDrive/a",
      errorCode: "EPERM",
      message: "operation not permitted",
      pathClassification: classifyPathEnvironment("/Users/x/OneDrive/a"),
    })

    await hook["tool.execute.after"](input, afterOutput)

    expect(afterOutput.output).toContain("base\n\n---")
    expect(afterOutput.output).toContain("OneDrive")
  })

  it("leaves output unchanged when no skips happen during window", async () => {
    const hook = createFsyncSkipWarningHook()
    const input = { tool: "write", sessionID: "ses1", callID: "call-3" }
    const beforeOutput = { args: {} as Record<string, unknown> }
    const afterOutput = { title: "ok", output: "base", metadata: {} as Record<string, unknown> }

    await hook["tool.execute.before"](input, beforeOutput)
    await hook["tool.execute.after"](input, afterOutput)

    expect(afterOutput.output).toBe("base")
  })

  it("isolates multiple parallel calls by callID watermark", async () => {
    const hook = createFsyncSkipWarningHook()
    const beforeOutput = { args: {} as Record<string, unknown> }

    const inputA = { tool: "write", sessionID: "ses1", callID: "call-A" }
    const inputB = { tool: "write", sessionID: "ses1", callID: "call-B" }

    await hook["tool.execute.before"](inputA, beforeOutput)
    await Bun.sleep(2)
    await hook["tool.execute.before"](inputB, beforeOutput)
    await Bun.sleep(2)

    recordFsyncSkip({
      filePath: "/tmp/a",
      contextLabel: "atomicWrite:/tmp/a",
      errorCode: "EPERM",
      message: "operation not permitted",
      pathClassification: classifyPathEnvironment("/tmp/a"),
    })

    const outputA = { title: "ok", output: "A", metadata: {} as Record<string, unknown> }
    const outputB = { title: "ok", output: "B", metadata: {} as Record<string, unknown> }

    await hook["tool.execute.after"](inputA, outputA)
    await hook["tool.execute.after"](inputB, outputB)

    expect(outputA.output).toContain("[fsync-skipped]")
    expect(outputB.output).toBe("B")
  })
})
