import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createWriteExistingFileGuardHook } from "./index"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

describe("createWriteExistingFileGuardHook", () => {
  let tempDir: string
  let ctx: { directory: string }
  let hook: ReturnType<typeof createWriteExistingFileGuardHook>

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "write-guard-test-"))
    ctx = { directory: tempDir }
    hook = createWriteExistingFileGuardHook(ctx as any)
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe("tool.execute.before", () => {
    test("allows write to non-existing file", async () => {
      //#given
      const nonExistingFile = path.join(tempDir, "new-file.txt")
      const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { filePath: nonExistingFile, content: "hello" } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).resolves.toBeUndefined()
    })

    test("blocks write to existing file", async () => {
      //#given
      const existingFile = path.join(tempDir, "existing-file.txt")
      fs.writeFileSync(existingFile, "existing content")
      const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { filePath: existingFile, content: "new content" } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).rejects.toThrow("File already exists. Use edit tool instead.")
    })

    test("blocks write tool (lowercase) to existing file", async () => {
      //#given
      const existingFile = path.join(tempDir, "existing-file.txt")
      fs.writeFileSync(existingFile, "existing content")
      const input = { tool: "write", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { filePath: existingFile, content: "new content" } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).rejects.toThrow("File already exists. Use edit tool instead.")
    })

    test("ignores non-write tools", async () => {
      //#given
      const existingFile = path.join(tempDir, "existing-file.txt")
      fs.writeFileSync(existingFile, "existing content")
      const input = { tool: "Edit", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { filePath: existingFile, content: "new content" } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).resolves.toBeUndefined()
    })

    test("ignores tools without any file path arg", async () => {
      //#given
      const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { command: "ls" } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).resolves.toBeUndefined()
    })

    describe("alternative arg names", () => {
      test("blocks write using 'path' arg to existing file", async () => {
        //#given
        const existingFile = path.join(tempDir, "existing-file.txt")
        fs.writeFileSync(existingFile, "existing content")
        const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
        const output = { args: { path: existingFile, content: "new content" } }

        //#when
        const result = hook["tool.execute.before"]?.(input as any, output as any)

        //#then
        await expect(result).rejects.toThrow("File already exists. Use edit tool instead.")
      })

      test("blocks write using 'file_path' arg to existing file", async () => {
        //#given
        const existingFile = path.join(tempDir, "existing-file.txt")
        fs.writeFileSync(existingFile, "existing content")
        const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
        const output = { args: { file_path: existingFile, content: "new content" } }

        //#when
        const result = hook["tool.execute.before"]?.(input as any, output as any)

        //#then
        await expect(result).rejects.toThrow("File already exists. Use edit tool instead.")
      })

      test("allows write using 'path' arg to non-existing file", async () => {
        //#given
        const nonExistingFile = path.join(tempDir, "new-file.txt")
        const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
        const output = { args: { path: nonExistingFile, content: "hello" } }

        //#when
        const result = hook["tool.execute.before"]?.(input as any, output as any)

        //#then
        await expect(result).resolves.toBeUndefined()
      })

      test("allows write using 'file_path' arg to non-existing file", async () => {
        //#given
        const nonExistingFile = path.join(tempDir, "new-file.txt")
        const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
        const output = { args: { file_path: nonExistingFile, content: "hello" } }

        //#when
        const result = hook["tool.execute.before"]?.(input as any, output as any)

        //#then
        await expect(result).resolves.toBeUndefined()
      })
    })

    describe("relative path resolution using ctx.directory", () => {
      test("blocks write to existing file using relative path", async () => {
        //#given
        const existingFile = path.join(tempDir, "existing-file.txt")
        fs.writeFileSync(existingFile, "existing content")
        const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
        const output = { args: { filePath: "existing-file.txt", content: "new content" } }

        //#when
        const result = hook["tool.execute.before"]?.(input as any, output as any)

        //#then
        await expect(result).rejects.toThrow("File already exists. Use edit tool instead.")
      })

      test("allows write to non-existing file using relative path", async () => {
        //#given
        const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
        const output = { args: { filePath: "new-file.txt", content: "hello" } }

        //#when
        const result = hook["tool.execute.before"]?.(input as any, output as any)

        //#then
        await expect(result).resolves.toBeUndefined()
      })

      test("blocks write to nested relative path when file exists", async () => {
        //#given
        const subDir = path.join(tempDir, "subdir")
        fs.mkdirSync(subDir)
        const existingFile = path.join(subDir, "existing.txt")
        fs.writeFileSync(existingFile, "existing content")
        const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
        const output = { args: { filePath: "subdir/existing.txt", content: "new content" } }

        //#when
        const result = hook["tool.execute.before"]?.(input as any, output as any)

        //#then
        await expect(result).rejects.toThrow("File already exists. Use edit tool instead.")
      })

      test("uses ctx.directory not process.cwd for relative path resolution", async () => {
        //#given
        const existingFile = path.join(tempDir, "test-file.txt")
        fs.writeFileSync(existingFile, "content")
        const differentCtx = { directory: tempDir }
        const differentHook = createWriteExistingFileGuardHook(differentCtx as any)
        const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
        const output = { args: { filePath: "test-file.txt", content: "new" } }

        //#when
        const result = differentHook["tool.execute.before"]?.(input as any, output as any)

        //#then
        await expect(result).rejects.toThrow("File already exists. Use edit tool instead.")
      })
    })
  })
})
