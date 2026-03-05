import { describe, it, expect } from "bun:test"
import { createTaskResumeInfoHook } from "./index"

describe("createTaskResumeInfoHook", () => {
  const hook = createTaskResumeInfoHook()
  const afterHook = hook["tool.execute.after"]

  const createInput = (tool: string) => ({
    tool,
    sessionID: "test-session",
    callID: "test-call-id",
  })

  describe("#given MCP tool with undefined output.output", () => {
    describe("#when tool.execute.after is called", () => {
      it("#then should not crash", async () => {
        const input = createInput("task")
        const output = {
          title: "delegate_task",
          output: undefined as unknown as string,
          metadata: {},
        }

        await afterHook(input, output)

        expect(output.output).toBeUndefined()
      })
    })
  })

  describe("#given non-target tool", () => {
    describe("#when tool is not in TARGET_TOOLS", () => {
      it("#then should not modify output", async () => {
        const input = createInput("Read")
        const output = {
          title: "Read",
          output: "some output",
          metadata: {},
        }

        await afterHook(input, output)

        expect(output.output).toBe("some output")
      })
    })
  })

  describe("#given target tool with session ID in output", () => {
    describe("#when output contains a session ID", () => {
      it("#then should append resume info", async () => {
        const input = createInput("call_omo_agent")
        const output = {
          title: "delegate_task",
          output: "Task completed.\nSession ID: ses_abc123",
          metadata: {},
        }

        await afterHook(input, output)

        expect(output.output).toContain("to continue:")
        expect(output.output).toContain("ses_abc123")
      })
    })
  })

  describe("#given target tool with error output", () => {
    describe("#when output starts with Error:", () => {
      it("#then should not modify output", async () => {
        const input = createInput("task")
        const output = {
          title: "task",
          output: "Error: something went wrong",
          metadata: {},
        }

        await afterHook(input, output)

        expect(output.output).toBe("Error: something went wrong")
      })
    })
  })

  describe("#given target tool with already-continued output", () => {
    describe("#when output already contains continuation info", () => {
      it("#then should not add duplicate", async () => {
        const input = createInput("task")
        const output = {
          title: "task",
          output:
            'Done.\nSession ID: ses_abc123\nto continue: task(session_id="ses_abc123", prompt="...")',
          metadata: {},
        }

        await afterHook(input, output)

        const matches = output.output.match(/to continue:/g)
        expect(matches?.length).toBe(1)
      })
    })
  })
})
