import { describe, expect, test } from "bun:test"
import { bunVersionSatisfies, probeBunVersion } from "../bin/lib/bun-runtime.js"

describe("bun version floor", () => {
  describe("#given the bun version floor", () => {
    test("#then 1.4.0 and anything newer satisfy it", () => {
      expect(bunVersionSatisfies("1.4.0")).toBe(true)
      expect(bunVersionSatisfies("1.4.12")).toBe(true)
      expect(bunVersionSatisfies("1.10.0")).toBe(true)
      expect(bunVersionSatisfies("2.0.0")).toBe(true)
    })

    test("#then older, missing and unparseable versions do not", () => {
      expect(bunVersionSatisfies("1.3.9")).toBe(false)
      expect(bunVersionSatisfies("0.9.0")).toBe(false)
      expect(bunVersionSatisfies(undefined)).toBe(false)
      expect(bunVersionSatisfies("")).toBe(false)
      expect(bunVersionSatisfies("bun: command not found")).toBe(false)
    })
  })

  describe("#given the bun version probe", () => {
    type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void
    type ExecFile = (
      command: string,
      args: string[],
      options: Record<string, unknown>,
      callback: ExecFileCallback,
    ) => void

    test("#then it asks the discovered binary for --version and returns the trimmed answer", async () => {
      // given
      const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = []
      const execFile: ExecFile = (command, args, options, callback) => {
        calls.push({ command, args, options })
        callback(null, "1.4.0\n", "")
      }
      // when
      const version = await probeBunVersion("/opt/bunroot/bin/bun", { execFile })
      // then
      expect(version).toBe("1.4.0")
      expect(calls).toHaveLength(1)
      expect(calls[0]?.command).toBe("/opt/bunroot/bin/bun")
      expect(calls[0]?.args).toEqual(["--version"])
      expect(calls[0]?.options).toMatchObject({ windowsHide: true })
      expect(typeof calls[0]?.options.timeout).toBe("number")
    })

    test("#then a binary that fails to answer reports no version instead of throwing", async () => {
      // given
      const execFile: ExecFile = (_command, _args, _options, callback) => {
        callback(new Error("spawn EACCES"), "", "")
      }
      // when / then
      expect(await probeBunVersion("/opt/bunroot/bin/bun", { execFile })).toBeUndefined()
    })
  })
})
