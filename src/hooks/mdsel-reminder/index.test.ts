import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { createMdselReminderHook } from "./index"
import { writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("createMdselReminderHook", () => {
  const testDir = join(tmpdir(), "mdsel-reminder-test-" + Date.now())
  let hook: ReturnType<typeof createMdselReminderHook>

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true })
    hook = createMdselReminderHook({ directory: testDir } as never)
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test("triggers reminder for .md file over 200 words", async () => {
    // #given - a markdown file with >200 words
    const filePath = join(testDir, "large.md")
    const content = Array(250).fill("word").join(" ")
    writeFileSync(filePath, content)

    const input = { tool: "Read", sessionID: "ses_123", callID: "call_001" }
    const beforeOutput = { args: { filePath } }
    const afterOutput = { title: "Read", output: "file content", metadata: {} }

    // #when - call before then after
    await hook["tool.execute.before"](input, beforeOutput)
    await hook["tool.execute.after"](input, afterOutput)

    // #then
    expect(afterOutput.output).toContain("[mdsel Reminder]")
    expect(afterOutput.output).toContain("250 words")
  })

  test("does NOT trigger reminder for .md file under 200 words", async () => {
    // #given - a markdown file with <200 words
    const filePath = join(testDir, "small.md")
    const content = Array(100).fill("word").join(" ")
    writeFileSync(filePath, content)

    const input = { tool: "Read", sessionID: "ses_123", callID: "call_002" }
    const beforeOutput = { args: { filePath } }
    const afterOutput = { title: "Read", output: "file content", metadata: {} }

    // #when
    await hook["tool.execute.before"](input, beforeOutput)
    await hook["tool.execute.after"](input, afterOutput)

    // #then
    expect(afterOutput.output).not.toContain("[mdsel Reminder]")
  })

  test("does NOT trigger for non-.md files", async () => {
    // #given - a non-markdown file
    const filePath = join(testDir, "code.ts")
    const content = Array(500).fill("word").join(" ")
    writeFileSync(filePath, content)

    const input = { tool: "Read", sessionID: "ses_123", callID: "call_003" }
    const beforeOutput = { args: { filePath } }
    const afterOutput = { title: "Read", output: "file content", metadata: {} }

    // #when
    await hook["tool.execute.before"](input, beforeOutput)
    await hook["tool.execute.after"](input, afterOutput)

    // #then
    expect(afterOutput.output).not.toContain("[mdsel Reminder]")
  })

  test("does NOT trigger for non-Read tools", async () => {
    // #given - a Write tool call
    const filePath = join(testDir, "write-test.md")
    const content = Array(500).fill("word").join(" ")
    writeFileSync(filePath, content)

    const input = { tool: "Write", sessionID: "ses_123", callID: "call_004" }
    const beforeOutput = { args: { filePath } }
    const afterOutput = { title: "Write", output: "success", metadata: {} }

    // #when
    await hook["tool.execute.before"](input, beforeOutput)
    await hook["tool.execute.after"](input, afterOutput)

    // #then
    expect(afterOutput.output).not.toContain("[mdsel Reminder]")
  })

  test("handles case-insensitive tool names", async () => {
    // #given - lowercase "read"
    const filePath = join(testDir, "case-test.md")
    const content = Array(250).fill("word").join(" ")
    writeFileSync(filePath, content)

    const input = { tool: "read", sessionID: "ses_123", callID: "call_005" }
    const beforeOutput = { args: { filePath } }
    const afterOutput = { title: "read", output: "content", metadata: {} }

    // #when
    await hook["tool.execute.before"](input, beforeOutput)
    await hook["tool.execute.after"](input, afterOutput)

    // #then
    expect(afterOutput.output).toContain("[mdsel Reminder]")
  })

  test("handles file_path arg format", async () => {
    // #given - file_path instead of filePath
    const filePath = join(testDir, "alt-arg.md")
    const content = Array(250).fill("word").join(" ")
    writeFileSync(filePath, content)

    const input = { tool: "Read", sessionID: "ses_123", callID: "call_006" }
    const beforeOutput = { args: { file_path: filePath } }
    const afterOutput = { title: "Read", output: "content", metadata: {} }

    // #when
    await hook["tool.execute.before"](input, beforeOutput)
    await hook["tool.execute.after"](input, afterOutput)

    // #then
    expect(afterOutput.output).toContain("[mdsel Reminder]")
  })

  test("gracefully handles non-existent files", async () => {
    // #given - a file that doesn't exist
    const filePath = join(testDir, "nonexistent.md")

    const input = { tool: "Read", sessionID: "ses_123", callID: "call_007" }
    const beforeOutput = { args: { filePath } }
    const afterOutput = { title: "Read", output: "error", metadata: {} }

    // #when - should not throw
    await hook["tool.execute.before"](input, beforeOutput)
    await hook["tool.execute.after"](input, afterOutput)

    // #then
    expect(afterOutput.output).not.toContain("[mdsel Reminder]")
  })

  test("gracefully handles missing args in before", async () => {
    // #given - no args in before output
    const input = { tool: "Read", sessionID: "ses_123", callID: "call_008" }
    const beforeOutput = { args: {} }
    const afterOutput = { title: "Read", output: "content", metadata: {} }

    // #when - should not throw
    await hook["tool.execute.before"](input, beforeOutput)
    await hook["tool.execute.after"](input, afterOutput)

    // #then
    expect(afterOutput.output).not.toContain("[mdsel Reminder]")
  })

  test("gracefully handles no before call (orphaned after)", async () => {
    // #given - only after call without before
    const input = { tool: "Read", sessionID: "ses_123", callID: "call_orphan" }
    const afterOutput = { title: "Read", output: "content", metadata: {} }

    // #when - should not throw (no pendingCall found)
    await hook["tool.execute.after"](input, afterOutput)

    // #then
    expect(afterOutput.output).not.toContain("[mdsel Reminder]")
  })
})
