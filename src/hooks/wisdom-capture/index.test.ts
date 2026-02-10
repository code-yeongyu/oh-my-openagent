import { beforeEach, describe, expect, it, mock } from "bun:test"
import { markMcbUnavailable, resetMcbAvailability } from "../../features/mcb-integration"
import { createWisdomCaptureHook } from "./index"

describe("wisdom-capture", () => {
  beforeEach(() => {
    resetMcbAvailability()
  })

  const createInput = (tool = "Bash") => ({
    tool,
    sessionID: "session-1",
    callID: "call-1",
  })

  const createOutput = (text: string) => ({
    title: "Tool output",
    output: text,
    metadata: {} as Record<string, unknown>,
  })

  it("#given a failed attempt then successful approach #when processed #then captures error correction wisdom", async () => {
    //#given a failed attempt then successful approach
    const storeLearning = mock((_learning: any) => Promise.resolve())
    const hook = createWisdomCaptureHook({} as any, { storeLearning })

    await hook["tool.execute.after"](createInput("Bash"), createOutput("Error: command failed"))

    //#when the successful retry is processed
    await hook["tool.execute.after"](
      { ...createInput("Bash"), callID: "call-2" },
      createOutput("Command succeeded using a different approach"),
    )

    //#then it should capture an error-correction learning
    expect(storeLearning).toHaveBeenCalledTimes(1)
    const learning = storeLearning.mock.calls[0]?.[0]
    expect(learning?.kind).toBe("error-correction")
  })

  it("#given output with naming convention discovery #when processed #then captures pattern discovery wisdom", async () => {
    const storeLearning = mock((_learning: any) => Promise.resolve())
    const hook = createWisdomCaptureHook({} as any, { storeLearning })

    await hook["tool.execute.after"](
      createInput("Read"),
      createOutput("Discovered naming convention: createXHook factory pattern"),
    )

    expect(storeLearning).toHaveBeenCalledTimes(1)
    const learning = storeLearning.mock.calls[0]?.[0]
    expect(learning?.kind).toBe("pattern-discovery")
  })

  it("#given mcb is unavailable #when learning is detected #then degrades silently without storing", async () => {
    const storeLearning = mock((_learning: any) => Promise.resolve())
    const hook = createWisdomCaptureHook({} as any, { storeLearning })
    markMcbUnavailable()

    await hook["tool.execute.after"](
      createInput("Read"),
      createOutput("Discovered naming convention: createXHook factory pattern"),
    )

    expect(storeLearning).not.toHaveBeenCalled()
  })
})
