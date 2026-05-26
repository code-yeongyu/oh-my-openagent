/// <reference types="bun-types" />

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { createHashlineEditDiffEnhancerHook } from "./hook"

describe("hashline-edit-diff-enhancer hook", () => {
  let testDir: string
  let testFile: string

  beforeEach(() => {
    testDir = join(tmpdir(), `hashline-diff-test-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
    testFile = join(testDir, "test-file.ts")
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe("#given hook is disabled", () => {
    test("#when write tool fires #then hook does nothing", async () => {
      // given
      const hook = createHashlineEditDiffEnhancerHook({ hashline_edit: { enabled: false } })
      const output = { args: { filePath: testFile } }

      // when
      await hook["tool.execute.before"](
        { tool: "write", sessionID: "ses-1", callID: "call-1" },
        output,
      )

      // then - no capture stored, after hook returns early
      const afterOutput = { title: "", output: "ok", metadata: {} }
      await hook["tool.execute.after"](
        { tool: "write", sessionID: "ses-1", callID: "call-1" },
        afterOutput,
      )
      expect(afterOutput.metadata).toEqual({})
    })
  })

  describe("#given hook is enabled", () => {
    test("#when non-write tool fires #then hook does nothing", async () => {
      // given
      const hook = createHashlineEditDiffEnhancerHook({ hashline_edit: { enabled: true } })
      const output = { args: { filePath: testFile } }

      // when
      await hook["tool.execute.before"](
        { tool: "read", sessionID: "ses-1", callID: "call-1" },
        output,
      )

      // then
      const afterOutput = { title: "", output: "ok", metadata: {} }
      await hook["tool.execute.after"](
        { tool: "read", sessionID: "ses-1", callID: "call-1" },
        afterOutput,
      )
      expect(afterOutput.metadata).toEqual({})
    })

    test("#when write tool fires on existing file #then captures diff metadata", async () => {
      // given
      const oldContent = "line1\nline2\nline3\n"
      writeFileSync(testFile, oldContent)
      const hook = createHashlineEditDiffEnhancerHook({ hashline_edit: { enabled: true } })

      // when - before hook captures old content
      await hook["tool.execute.before"](
        { tool: "write", sessionID: "ses-1", callID: "call-1" },
        { args: { filePath: testFile } },
      )

      // simulate file being written with new content
      const newContent = "line1\nline2-modified\nline3\nline4\n"
      writeFileSync(testFile, newContent)

      // when - after hook computes diff
      const afterOutput = { title: "", output: "ok", metadata: {} as Record<string, unknown> }
      await hook["tool.execute.after"](
        { tool: "write", sessionID: "ses-1", callID: "call-1" },
        afterOutput,
      )

      // then
      const filediff = afterOutput.metadata.filediff as Record<string, unknown>
      expect(filediff).toBeDefined()
      expect(filediff.file).toBe(testFile)
      expect(filediff.additions).toBeGreaterThan(0)
      expect(afterOutput.metadata.diff).toBeDefined()
      expect(typeof afterOutput.metadata.diff).toBe("string")
      expect(afterOutput.title).toBe(testFile)
    })

    test("#when write tool fires on new file #then old content is empty string", async () => {
      // given - file does not exist
      const hook = createHashlineEditDiffEnhancerHook({ hashline_edit: { enabled: true } })

      // when - before hook captures (file doesn't exist yet)
      await hook["tool.execute.before"](
        { tool: "Write", sessionID: "ses-2", callID: "call-2" },
        { args: { filePath: testFile } },
      )

      // simulate file creation
      writeFileSync(testFile, "new content\n")

      // when - after hook
      const afterOutput = { title: "", output: "ok", metadata: {} as Record<string, unknown> }
      await hook["tool.execute.after"](
        { tool: "Write", sessionID: "ses-2", callID: "call-2" },
        afterOutput,
      )

      // then
      const filediff = afterOutput.metadata.filediff as Record<string, unknown>
      expect(filediff).toBeDefined()
      expect(filediff.before).toBe("")
      expect(filediff.after).toBe("new content\n")
    })

    test("#when after fires without matching before #then does nothing", async () => {
      // given
      const hook = createHashlineEditDiffEnhancerHook({ hashline_edit: { enabled: true } })

      // when - after without before
      const afterOutput = { title: "", output: "ok", metadata: {} as Record<string, unknown> }
      await hook["tool.execute.after"](
        { tool: "write", sessionID: "ses-3", callID: "call-3" },
        afterOutput,
      )

      // then
      expect(afterOutput.metadata).toEqual({})
      expect(afterOutput.title).toBe("")
    })
  })
})
