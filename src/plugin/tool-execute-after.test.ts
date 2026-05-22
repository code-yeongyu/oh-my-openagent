import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { _resetForTesting, setSessionAgent } from "../features/claude-code-session-state"
import { clearPendingStore, storeToolMetadata } from "../features/tool-metadata-store"
import { createToolExecuteAfterHandler } from "./tool-execute-after"

describe("createToolExecuteAfterHandler", () => {
  beforeEach(() => {
    clearPendingStore()
  })

  it("#given truncator changes output #when tool.execute.after runs #then claudeCodeHooks receives truncated output", async () => {
    const callOrder: string[] = []
    let claudeSawOutput = ""

    const handler = createToolExecuteAfterHandler({
      ctx: { directory: "/repo" } as never,
      hooks: {
        toolOutputTruncator: {
          "tool.execute.after": async (_input, output) => {
            callOrder.push("truncator")
            output.output = "truncated output"
          },
        },
        claudeCodeHooks: {
          "tool.execute.after": async (_input, output) => {
            callOrder.push("claude")
            claudeSawOutput = output.output
          },
        },
      } as never,
    })

    await handler(
      { tool: "hashline_edit", sessionID: "ses_test", callID: "call_test" },
      { title: "result", output: "original output", metadata: {} }
    )

    expect(callOrder).toEqual(["truncator", "claude"])
    expect(claudeSawOutput).toBe("truncated output")
  })

  it("#given stored metadata with legacy call id casing #when tool.execute.after runs #then it restores the stored metadata", async () => {
    // given
    storeToolMetadata("ses_parent", "call_legacy", {
      title: "stored title",
      metadata: { sessionId: "ses_child", agent: "oracle" },
    })

    const handler = createToolExecuteAfterHandler({
      ctx: { directory: "/repo" } as never,
      hooks: {} as never,
    })

    const output = { title: "result", output: "original output", metadata: { truncated: true } }

    // when
    await handler(
      { tool: "hashline_edit", sessionID: "ses_parent", callId: " call_legacy " },
      output
    )

    // then
    expect(output.title).toBe("stored title")
    expect(output.metadata).toEqual({ truncated: true, sessionId: "ses_child", agent: "oracle" })
  })

  it("#given native session metadata #when stored metadata exists #then stored metadata does not overwrite native session linkage", async () => {
    // given
    storeToolMetadata("ses_parent", "call_native", {
      title: "stored title",
      metadata: { sessionId: "ses_stored", agent: "oracle" },
    })

    const handler = createToolExecuteAfterHandler({
      ctx: { directory: "/repo" } as never,
      hooks: {} as never,
    })

    const output = {
      title: "result",
      output: "original output",
      metadata: { sessionId: "ses_native", agent: "hephaestus" },
    }

    // when
    await handler(
      { tool: "hashline_edit", sessionID: "ses_parent", callID: "call_native" },
      output
    )

    // then
    expect(output.title).toBe("stored title")
    expect(output.metadata).toEqual({ sessionId: "ses_native", agent: "hephaestus" })
  })
  it("#given native session linkage without model #when stored metadata exists #then required task metadata is preserved", async () => {
    // given
    const model = { providerID: "openai", modelID: "gpt-5.5" }
    storeToolMetadata("ses_parent", "call_model", {
      title: "stored title",
      metadata: { sessionId: "ses_stored", agent: "oracle", model },
    })

    const handler = createToolExecuteAfterHandler({
      ctx: {} as never,
      hooks: {} as never,
    })

    const output = {
      title: "result",
      output: "original output",
      metadata: { sessionId: "ses_native", agent: "hephaestus" },
    }

    // when
    await handler(
      { tool: "task", sessionID: "ses_parent", callID: "call_model" },
      output
    )

    // then
    expect(output.title).toBe("stored title")
    expect(output.metadata).toEqual({ sessionId: "ses_native", agent: "hephaestus", model })
  })

  it("#given a non-extract hook throws #when tool.execute.after runs #then the handler absorbs the failure", async () => {
    // given
    const handler = createToolExecuteAfterHandler({
      ctx: { directory: "/repo" } as never,
      hooks: {
        directoryAgentsInjector: {
          "tool.execute.after": async () => {
            throw new TypeError("output output is undefined")
          },
        },
      } as never,
    })

    const output = { title: "result", output: "read output", metadata: {} }

    // when
    await handler(
      { tool: "read", sessionID: "ses_parent", callID: "call_read" },
      output
    )

    // then
    expect(output).toEqual({ title: "result", output: "read output", metadata: {} })
  })

  it("#given after input includes tool args #when comment checker runs #then it receives the args", async () => {
    // given
    let seenArgs: Record<string, unknown> | undefined
    const handler = createToolExecuteAfterHandler({
      ctx: { directory: "/repo" } as never,
      hooks: {
        commentChecker: {
          "tool.execute.after": async (input) => {
            seenArgs = input.args
          },
        },
      } as never,
    })

    const args = { patchText: "*** Begin Patch\n*** End Patch" }

    // when
    await handler(
      { tool: "apply_patch", sessionID: "ses_parent", callID: "call_patch", args },
      { title: "result", output: "Success", metadata: {} },
    )

    // then
    expect(seenArgs).toBe(args)
  })

  // regression: issue #3735 — for `excluded_agents`, omo's three tool-output
  // injectors (rules / AGENTS.md / README) must be silenced so a custom
  // lightweight agent (e.g. cybersec) doesn't accumulate omo banner content
  // in tool output context.
  describe("excluded_agents guard (#3735)", () => {
    beforeEach(() => {
      _resetForTesting()
    })
    afterEach(() => {
      _resetForTesting()
    })

    it("skips rules/agents-md/readme injectors when the session agent is excluded", async () => {
      // given
      setSessionAgent("ses_excluded", "cybersec")
      const callOrder: string[] = []
      const handler = createToolExecuteAfterHandler({
        ctx: { directory: "/repo" } as never,
        hooks: {
          toolOutputTruncator: {
            "tool.execute.after": async () => { callOrder.push("truncator") },
          },
          rulesInjector: {
            "tool.execute.after": async () => { callOrder.push("rules") },
          },
          directoryAgentsInjector: {
            "tool.execute.after": async () => { callOrder.push("agents-md") },
          },
          directoryReadmeInjector: {
            "tool.execute.after": async () => { callOrder.push("readme") },
          },
        } as never,
        excludedAgents: ["cybersec"],
      })

      // when
      await handler(
        { tool: "hashline_edit", sessionID: "ses_excluded", callID: "c1" },
        { title: "result", output: "out", metadata: {} },
      )

      // then: safety hooks ran; omo-specific injectors did NOT
      expect(callOrder).toContain("truncator")
      expect(callOrder).not.toContain("rules")
      expect(callOrder).not.toContain("agents-md")
      expect(callOrder).not.toContain("readme")
    })

    it("still runs all injectors for non-excluded agents", async () => {
      // given
      setSessionAgent("ses_sisyphus", "sisyphus")
      const callOrder: string[] = []
      const handler = createToolExecuteAfterHandler({
        ctx: { directory: "/repo" } as never,
        hooks: {
          toolOutputTruncator: {
            "tool.execute.after": async () => { callOrder.push("truncator") },
          },
          rulesInjector: {
            "tool.execute.after": async () => { callOrder.push("rules") },
          },
          directoryAgentsInjector: {
            "tool.execute.after": async () => { callOrder.push("agents-md") },
          },
          directoryReadmeInjector: {
            "tool.execute.after": async () => { callOrder.push("readme") },
          },
        } as never,
        excludedAgents: ["cybersec"],
      })

      // when
      await handler(
        { tool: "hashline_edit", sessionID: "ses_sisyphus", callID: "c2" },
        { title: "result", output: "out", metadata: {} },
      )

      // then: order matches tool-execute-after.ts hook sequence
      expect(callOrder).toEqual(["truncator", "agents-md", "readme", "rules"])
    })

    it("runs all injectors when excluded_agents is undefined (backwards compatibility)", async () => {
      // given
      setSessionAgent("ses_default", "cybersec")
      const callOrder: string[] = []
      const handler = createToolExecuteAfterHandler({
        ctx: { directory: "/repo" } as never,
        hooks: {
          rulesInjector: {
            "tool.execute.after": async () => { callOrder.push("rules") },
          },
          directoryAgentsInjector: {
            "tool.execute.after": async () => { callOrder.push("agents-md") },
          },
        } as never,
        // no excludedAgents
      })

      // when
      await handler(
        { tool: "hashline_edit", sessionID: "ses_default", callID: "c3" },
        { title: "result", output: "out", metadata: {} },
      )

      // then
      expect(callOrder).toEqual(["agents-md", "rules"])
    })
  })
})
