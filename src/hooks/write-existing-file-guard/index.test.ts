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

    describe(".sisyphus/*.md exception", () => {
      test("allows write to existing .sisyphus/plans/plan.md", async () => {
        //#given
        const sisyphusDir = path.join(tempDir, ".sisyphus", "plans")
        fs.mkdirSync(sisyphusDir, { recursive: true })
        const planFile = path.join(sisyphusDir, "plan.md")
        fs.writeFileSync(planFile, "# Existing Plan")
        const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
        const output = { args: { filePath: planFile, content: "# Updated Plan" } }

        //#when
        const result = hook["tool.execute.before"]?.(input as any, output as any)

        //#then
        await expect(result).resolves.toBeUndefined()
      })

      test("allows write to existing .sisyphus/notes.md", async () => {
        //#given
        const sisyphusDir = path.join(tempDir, ".sisyphus")
        fs.mkdirSync(sisyphusDir, { recursive: true })
        const notesFile = path.join(sisyphusDir, "notes.md")
        fs.writeFileSync(notesFile, "# Notes")
        const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
        const output = { args: { filePath: notesFile, content: "# Updated Notes" } }

        //#when
        const result = hook["tool.execute.before"]?.(input as any, output as any)

        //#then
        await expect(result).resolves.toBeUndefined()
      })

      test("allows write to existing .sisyphus/*.md using relative path", async () => {
        //#given
        const sisyphusDir = path.join(tempDir, ".sisyphus")
        fs.mkdirSync(sisyphusDir, { recursive: true })
        const planFile = path.join(sisyphusDir, "plan.md")
        fs.writeFileSync(planFile, "# Plan")
        const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
        const output = { args: { filePath: ".sisyphus/plan.md", content: "# Updated" } }

        //#when
        const result = hook["tool.execute.before"]?.(input as any, output as any)

        //#then
        await expect(result).resolves.toBeUndefined()
      })

      test("blocks write to existing .sisyphus/file.txt (non-markdown)", async () => {
        //#given
        const sisyphusDir = path.join(tempDir, ".sisyphus")
        fs.mkdirSync(sisyphusDir, { recursive: true })
        const textFile = path.join(sisyphusDir, "file.txt")
        fs.writeFileSync(textFile, "content")
        const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
        const output = { args: { filePath: textFile, content: "new content" } }

        //#when
        const result = hook["tool.execute.before"]?.(input as any, output as any)

        //#then
        await expect(result).rejects.toThrow("File already exists. Use edit tool instead.")
      })

      test("blocks write when .sisyphus is in parent path but not under ctx.directory", async () => {
        //#given
        const fakeSisyphusParent = path.join(os.tmpdir(), ".sisyphus", "evil-project")
        fs.mkdirSync(fakeSisyphusParent, { recursive: true })
        const evilFile = path.join(fakeSisyphusParent, "plan.md")
        fs.writeFileSync(evilFile, "# Evil Plan")
        const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
        const output = { args: { filePath: evilFile, content: "# Hacked" } }

        //#when
        const result = hook["tool.execute.before"]?.(input as any, output as any)

        //#then
        await expect(result).rejects.toThrow("File already exists. Use edit tool instead.")

        // cleanup
        fs.rmSync(path.join(os.tmpdir(), ".sisyphus"), { recursive: true, force: true })
      })

      test("blocks write to existing regular file (not in .sisyphus)", async () => {
        //#given
        const regularFile = path.join(tempDir, "regular.md")
        fs.writeFileSync(regularFile, "# Regular")
        const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
        const output = { args: { filePath: regularFile, content: "# Updated" } }

        //#when
        const result = hook["tool.execute.before"]?.(input as any, output as any)

        //#then
        await expect(result).rejects.toThrow("File already exists. Use edit tool instead.")
      })
    })
   })
})
})
