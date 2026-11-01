import { describe, expect, it } from "bun:test"

import { createBashFileReadGuardHook, WARNING_MESSAGE } from "./bash-file-read-guard"

describe("createBashFileReadGuardHook", () => {
  describe("tool.execute.before", () => {
    it("records pending warning for simple cat command without setting output.message", async () => {
      // given
      const hook = createBashFileReadGuardHook()
      const input = { tool: "bash", sessionID: "ses1", callID: "call-1" }
      const beforeOutput: Record<string, unknown> & { args: Record<string, unknown>; message?: string } = {
        args: { command: "cat README.md" },
      }

      // when
      await hook["tool.execute.before"]!(input, beforeOutput as never)

      // then
      expect(beforeOutput.message).toBeUndefined()
      // pending is internal - prove via after
      const afterInput = { tool: "bash", sessionID: "ses1", callID: "call-1", args: { command: "cat README.md" } }
      const afterOutput = { title: "bash", output: "file contents", metadata: {} }
      await hook["tool.execute.after"]!(afterInput as never, afterOutput as never)
      expect(afterOutput.output).toBe(`${WARNING_MESSAGE}\n\nfile contents`)
    })

    it("does not record for non-bash tool", async () => {
      const hook = createBashFileReadGuardHook()
      const input = { tool: "read", sessionID: "ses1", callID: "call-2" }
      const beforeOutput = { args: { command: "cat README.md" } } as never
      await hook["tool.execute.before"]!(input, beforeOutput)
      const afterInput = { tool: "read", sessionID: "ses1", callID: "call-2" } as never
      const afterOutput = { title: "read", output: "contents", metadata: {} }
      await hook["tool.execute.after"]!(afterInput, afterOutput as never)
      expect(afterOutput.output).toBe("contents")
    })

    it("does not record for complex piped command", async () => {
      const hook = createBashFileReadGuardHook()
      const input = { tool: "bash", sessionID: "ses1", callID: "call-3" }
      const beforeOutput = { args: { command: "cat file.txt | grep foo" } } as never
      await hook["tool.execute.before"]!(input, beforeOutput)
      const afterInput = { tool: "bash", sessionID: "ses1", callID: "call-3", args: { command: "cat file.txt | grep foo" } } as never
      const afterOutput = { title: "bash", output: "piped", metadata: {} }
      await hook["tool.execute.after"]!(afterInput as never, afterOutput as never)
      expect(afterOutput.output).toBe("piped")
    })
  })

  describe("tool.execute.after", () => {
    it("prepends warning to output via pending set (before+after flow)", async () => {
      const hook = createBashFileReadGuardHook()
      const inputBefore = { tool: "bash", sessionID: "ses1", callID: "call-a" }
      await hook["tool.execute.before"]!(inputBefore, { args: { command: "cat src/index.ts" } } as never)

      const inputAfter = { tool: "bash", sessionID: "ses1", callID: "call-a", args: { command: "cat src/index.ts" } } as never
      const output = { title: "bash", output: "original output", metadata: {} }
      await hook["tool.execute.after"]!(inputAfter, output as never)
      expect(output.output).toBe(`${WARNING_MESSAGE}\n\noriginal output`)
    })

    it("prepends warning via direct args detection when before was not called (fallback)", async () => {
      const hook = createBashFileReadGuardHook()
      const inputAfter = { tool: "bash", sessionID: "ses1", callID: "call-direct", args: { command: "head README.md" } } as never
      const output = { title: "bash", output: "head contents", metadata: {} }
      await hook["tool.execute.after"]!(inputAfter, output as never)
      expect(output.output).toBe(`${WARNING_MESSAGE}\n\nhead contents`)
    })

    it("supports head -n and tail -n variants", async () => {
      const hook = createBashFileReadGuardHook()
      for (const cmd of ["head -n 20 file.txt", "head -n 20  file.txt", "tail -n 10 file.txt", "tail file.txt"]) {
        const callID = `call-${cmd}`
        await hook["tool.execute.before"]!({ tool: "bash", sessionID: "ses1", callID } as never, { args: { command: cmd } } as never)
        const output = { title: "bash", output: "out", metadata: {} }
        await hook["tool.execute.after"]!({ tool: "bash", sessionID: "ses1", callID, args: { command: cmd } } as never, output as never)
        expect(output.output).toBe(`${WARNING_MESSAGE}\n\nout`)
      }
    })

    it("does not warn for non-simple file reads", async () => {
      const hook = createBashFileReadGuardHook()
      const cases = ["cat -n file", "cat", "head -n", "tail -n abc file", "cat file; echo done", "cat file && echo done"]
      for (const cmd of cases) {
        const callID = `call-${Math.random()}`
        const out = { title: "bash", output: "out", metadata: {} }
        await hook["tool.execute.after"]!({ tool: "bash", sessionID: "ses1", callID, args: { command: cmd } } as never, out as never)
        expect(out.output).toBe("out")
      }
    })

    it("handles Bash case-insensitively", async () => {
      const hook = createBashFileReadGuardHook()
      const inputAfter = { tool: "Bash", sessionID: "ses1", callID: "ci", args: { command: "cat file.txt" } } as never
      const output = { title: "bash", output: "data", metadata: {} }
      await hook["tool.execute.after"]!(inputAfter, output as never)
      expect(output.output).toContain(WARNING_MESSAGE)
    })

    it("does not duplicate warning if output already contains it", async () => {
      const hook = createBashFileReadGuardHook()
      await hook["tool.execute.before"]!({ tool: "bash", sessionID: "ses1", callID: "dup" } as never, { args: { command: "cat file" } } as never)
      const output = { title: "bash", output: `${WARNING_MESSAGE}\n\nalready`, metadata: {} }
      await hook["tool.execute.after"]!({ tool: "bash", sessionID: "ses1", callID: "dup", args: { command: "cat file" } } as never, output as never)
      expect(output.output).toBe(`${WARNING_MESSAGE}\n\nalready`)
      // no double prepend
      expect((output.output.match(new RegExp(WARNING_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length).toBe(1)
    })

    it("consumes pending so second after with same callID does not re-warn", async () => {
      const hook = createBashFileReadGuardHook()
      await hook["tool.execute.before"]!({ tool: "bash", sessionID: "ses1", callID: "once" } as never, { args: { command: "cat file" } } as never)
      const out1 = { title: "bash", output: "first", metadata: {} }
      await hook["tool.execute.after"]!({ tool: "bash", sessionID: "ses1", callID: "once", args: { command: "cat file" } } as never, out1 as never)
      expect(out1.output).toContain(WARNING_MESSAGE)

      // second after with same callID but no pending and no args fallback via different command should not warn
      const out2 = { title: "bash", output: "second", metadata: {} }
      await hook["tool.execute.after"]!({ tool: "bash", sessionID: "ses1", callID: "once", args: { command: "echo hello" } } as never, out2 as never)
      expect(out2.output).toBe("second")
    })

    it("isolates pending warnings by callID", async () => {
      const hook = createBashFileReadGuardHook()
      await hook["tool.execute.before"]!({ tool: "bash", sessionID: "ses1", callID: "a" } as never, { args: { command: "cat a.txt" } } as never)
      await hook["tool.execute.before"]!({ tool: "bash", sessionID: "ses1", callID: "b" } as never, { args: { command: "echo hello" } } as never)

      const outA = { title: "bash", output: "A", metadata: {} }
      const outB = { title: "bash", output: "B", metadata: {} }
      await hook["tool.execute.after"]!({ tool: "bash", sessionID: "ses1", callID: "a", args: { command: "cat a.txt" } } as never, outA as never)
      await hook["tool.execute.after"]!({ tool: "bash", sessionID: "ses1", callID: "b", args: { command: "echo hello" } } as never, outB as never)
      expect(outA.output).toContain(WARNING_MESSAGE)
      expect(outB.output).toBe("B")
    })

    it("leaves non-string output untouched", async () => {
      const hook = createBashFileReadGuardHook()
      await hook["tool.execute.before"]!({ tool: "bash", sessionID: "ses1", callID: "ns" } as never, { args: { command: "cat file" } } as never)
      const out = { title: "bash", output: null as unknown as string, metadata: {} }
      await hook["tool.execute.after"]!({ tool: "bash", sessionID: "ses1", callID: "ns", args: { command: "cat file" } } as never, out as never)
      expect(out.output).toBeNull()
    })
  })
})
