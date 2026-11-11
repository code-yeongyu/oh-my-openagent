import { describe, expect, it } from "bun:test"

import { createBashFileReadGuardHook, WARNING_MESSAGE } from "./bash-file-read-guard"

type AfterInput = { tool: string; sessionID: string; callID: string; args?: Record<string, unknown> }
type AfterOutput = { title: string; output: string; metadata: unknown }
type BashFileReadGuardHook = ReturnType<typeof createBashFileReadGuardHook>

async function runAfter(hook: BashFileReadGuardHook, input: AfterInput, output: AfterOutput): Promise<void> {
  await hook["tool.execute.after"](input, output)
}

function countWarnings(value: string): number {
  return value.split(WARNING_MESSAGE).length - 1
}

describe("createBashFileReadGuardHook", () => {
  describe("tool.execute.after", () => {
    describe("simple file reads", () => {
      it("prepends the warning to a cat read", async () => {
        // given
        const hook = createBashFileReadGuardHook()
        const output = { title: "bash", output: "file contents", metadata: {} }

        // when
        await runAfter(hook, { tool: "bash", sessionID: "ses1", callID: "call-cat", args: { command: "cat file" } }, output)

        // then
        expect(output.output).toBe(`${WARNING_MESSAGE}\n\nfile contents`)
      })

      it("prepends the warning to head and tail reads", async () => {
        // given
        const hook = createBashFileReadGuardHook()
        const commands = ["head -n 5 file", "head file", "tail file", "tail -n 10 file"]

        // when
        const outputs: string[] = []
        for (const command of commands) {
          const output = { title: "bash", output: "read contents", metadata: {} }
          await runAfter(hook, { tool: "bash", sessionID: "ses1", callID: `call-${command}`, args: { command } }, output)
          outputs.push(output.output)
        }

        // then
        for (const output of outputs) {
          expect(output).toBe(`${WARNING_MESSAGE}\n\nread contents`)
        }
      })

      it("warns once for the same output, never twice", async () => {
        // given
        const hook = createBashFileReadGuardHook()
        const input = { tool: "bash", sessionID: "ses1", callID: "call-twice", args: { command: "cat file" } }
        const output = { title: "bash", output: "file contents", metadata: {} }

        // when
        await runAfter(hook, input, output)
        await runAfter(hook, input, output)

        // then
        expect(output.output).toBe(`${WARNING_MESSAGE}\n\nfile contents`)
        expect(countWarnings(output.output)).toBe(1)
      })

      it("leaves an output that already carries the warning untouched", async () => {
        // given
        const hook = createBashFileReadGuardHook()
        const output = { title: "bash", output: `${WARNING_MESSAGE}\n\nalready warned`, metadata: {} }

        // when
        await runAfter(hook, { tool: "bash", sessionID: "ses1", callID: "call-dup", args: { command: "cat file" } }, output)

        // then
        expect(output.output).toBe(`${WARNING_MESSAGE}\n\nalready warned`)
        expect(countWarnings(output.output)).toBe(1)
      })

      it("handles the Bash tool name case-insensitively", async () => {
        // given
        const hook = createBashFileReadGuardHook()
        const output = { title: "bash", output: "data", metadata: {} }

        // when
        await runAfter(hook, { tool: "Bash", sessionID: "ses1", callID: "call-ci", args: { command: "cat file.txt" } }, output)

        // then
        expect(output.output).toBe(`${WARNING_MESSAGE}\n\ndata`)
      })
    })

    describe("unrelated commands", () => {
      it("leaves ls, git status, echo and piped cat untouched", async () => {
        // given
        const hook = createBashFileReadGuardHook()
        const commands = ["ls", "cat f | wc -l", "git status", "echo hi"]

        // when
        const outputs: string[] = []
        for (const command of commands) {
          const output = { title: "bash", output: "plain output", metadata: {} }
          await runAfter(hook, { tool: "bash", sessionID: "ses1", callID: `call-${command}`, args: { command } }, output)
          outputs.push(output.output)
        }

        // then
        for (const output of outputs) {
          expect(output).toBe("plain output")
        }
      })

      it("leaves non-simple cat and head forms untouched", async () => {
        // given
        const hook = createBashFileReadGuardHook()
        const commands = ["cat -n file", "cat", "head -n", "tail -n abc file", "cat file; echo done", "cat file && echo done"]

        // when
        const outputs: string[] = []
        for (const command of commands) {
          const output = { title: "bash", output: "plain output", metadata: {} }
          await runAfter(hook, { tool: "bash", sessionID: "ses1", callID: `call-${command}`, args: { command } }, output)
          outputs.push(output.output)
        }

        // then
        for (const output of outputs) {
          expect(output).toBe("plain output")
        }
      })

      it("leaves non-bash tools untouched", async () => {
        // given
        const hook = createBashFileReadGuardHook()
        const output = { title: "read", output: "contents", metadata: {} }

        // when
        await runAfter(hook, { tool: "read", sessionID: "ses1", callID: "call-read", args: { command: "cat file" } }, output)

        // then
        expect(output.output).toBe("contents")
      })

      it("leaves non-string output untouched", async () => {
        // given
        const hook = createBashFileReadGuardHook()
        const output = { title: "bash", output: null as unknown as string, metadata: {} }

        // when
        await runAfter(hook, { tool: "bash", sessionID: "ses1", callID: "call-null", args: { command: "cat file" } }, output)

        // then
        expect(output.output).toBeNull()
      })

      it("leaves a call without args untouched", async () => {
        // given
        const hook = createBashFileReadGuardHook()
        const output = { title: "bash", output: "plain output", metadata: {} }

        // when
        await runAfter(hook, { tool: "bash", sessionID: "ses1", callID: "call-noargs" }, output)

        // then
        expect(output.output).toBe("plain output")
      })

      it("leaves a call whose command is not a string untouched", async () => {
        // given
        const hook = createBashFileReadGuardHook()
        const output = { title: "bash", output: "plain output", metadata: {} }

        // when
        await runAfter(hook, { tool: "bash", sessionID: "ses1", callID: "call-numcmd", args: { command: 42 } }, output)

        // then
        expect(output.output).toBe("plain output")
      })
    })

    describe("call identity", () => {
      it("does not warn an unrelated command that reuses a callID which previously warned for a read", async () => {
        // given
        const hook = createBashFileReadGuardHook()
        const readOutput = { title: "bash", output: "file contents", metadata: {} }
        await runAfter(hook, { tool: "bash", sessionID: "ses1", callID: "call-reused", args: { command: "cat file" } }, readOutput)
        expect(readOutput.output).toBe(`${WARNING_MESSAGE}\n\nfile contents`)
        const unrelatedOutput = { title: "bash", output: "plain output", metadata: {} }

        // when
        await runAfter(hook, { tool: "bash", sessionID: "ses1", callID: "call-reused", args: { command: "git status" } }, unrelatedOutput)

        // then
        expect(unrelatedOutput.output).toBe("plain output")
      })

      it("decides from the after-phase args when they differ from anything seen earlier for the callID", async () => {
        // given
        const hook = createBashFileReadGuardHook()
        const earlierOutput = { title: "bash", output: "plain output", metadata: {} }
        await runAfter(hook, { tool: "bash", sessionID: "ses1", callID: "call-rewritten", args: { command: "echo hi" } }, earlierOutput)
        expect(earlierOutput.output).toBe("plain output")
        const rewrittenOutput = { title: "bash", output: "file contents", metadata: {} }

        // when
        await runAfter(hook, { tool: "bash", sessionID: "ses1", callID: "call-rewritten", args: { command: "cat file" } }, rewrittenOutput)

        // then
        expect(rewrittenOutput.output).toBe(`${WARNING_MESSAGE}\n\nfile contents`)
      })

      it("decides from the after-phase args when the earlier call carried no args", async () => {
        // given
        const hook = createBashFileReadGuardHook()
        const withoutArgs = { title: "bash", output: "plain output", metadata: {} }
        await runAfter(hook, { tool: "bash", sessionID: "ses1", callID: "call-late-args" }, withoutArgs)
        expect(withoutArgs.output).toBe("plain output")
        const withArgs = { title: "bash", output: "file contents", metadata: {} }

        // when
        await runAfter(hook, { tool: "bash", sessionID: "ses1", callID: "call-late-args", args: { command: "tail file" } }, withArgs)

        // then
        expect(withArgs.output).toBe(`${WARNING_MESSAGE}\n\nfile contents`)
      })
    })
  })
})
