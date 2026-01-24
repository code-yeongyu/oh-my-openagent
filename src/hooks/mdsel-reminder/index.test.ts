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
    hook = createMdselReminderHook({} as never)
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test("triggers reminder for .md file over 200 words", async () => {
    // #given - a markdown file with >200 words
    const filePath = join(testDir, "large.md")
    const content = Array(250).fill("word").join(" ")
    writeFileSync(filePath, content)

    const input = { tool: "Read", sessionID: "ses_123", callID: "call_456" }
    const output = { title: "Read", output: "file content", metadata: {}, args: { filePath } }

    // #when
    await hook["tool.execute.after"](input, output)

    // #then
    expect(output.output).toContain("[mdsel Reminder]")
    expect(output.output).toContain("250 words")
  })

  test("does NOT trigger reminder for .md file under 200 words", async () => {
    // #given - a markdown file with <200 words
    const filePath = join(testDir, "small.md")
    const content = Array(100).fill("word").join(" ")
    writeFileSync(filePath, content)

    const input = { tool: "Read", sessionID: "ses_123", callID: "call_456" }
    const output = { title: "Read", output: "file content", metadata: {}, args: { filePath } }

    // #when
    await hook["tool.execute.after"](input, output)

    // #then
    expect(output.output).not.toContain("[mdsel Reminder]")
  })

  test("does NOT trigger for non-.md files", async () => {
    // #given - a non-markdown file
    const filePath = join(testDir, "code.ts")
    const content = Array(500).fill("word").join(" ")
    writeFileSync(filePath, content)

    const input = { tool: "Read", sessionID: "ses_123", callID: "call_456" }
    const output = { title: "Read", output: "file content", metadata: {}, args: { filePath } }

    // #when
    await hook["tool.execute.after"](input, output)

    // #then
    expect(output.output).not.toContain("[mdsel Reminder]")
  })

  test("does NOT trigger for non-Read tools", async () => {
    // #given - a Write tool call
    const filePath = join(testDir, "write-test.md")
    const content = Array(500).fill("word").join(" ")
    writeFileSync(filePath, content)

    const input = { tool: "Write", sessionID: "ses_123", callID: "call_456" }
    const output = { title: "Write", output: "success", metadata: {}, args: { filePath } }

    // #when
    await hook["tool.execute.after"](input, output)

    // #then
    expect(output.output).not.toContain("[mdsel Reminder]")
  })

  test("handles case-insensitive tool names", async () => {
    // #given - lowercase "read"
    const filePath = join(testDir, "case-test.md")
    const content = Array(250).fill("word").join(" ")
    writeFileSync(filePath, content)

    const input = { tool: "read", sessionID: "ses_123", callID: "call_456" }
    const output = { title: "read", output: "content", metadata: {}, args: { filePath } }

    // #when
    await hook["tool.execute.after"](input, output)

    // #then
    expect(output.output).toContain("[mdsel Reminder]")
  })

  test("handles file_path arg format", async () => {
    // #given - file_path instead of filePath
    const filePath = join(testDir, "alt-arg.md")
    const content = Array(250).fill("word").join(" ")
    writeFileSync(filePath, content)

    const input = { tool: "Read", sessionID: "ses_123", callID: "call_456" }
    const output = { title: "Read", output: "content", metadata: {}, args: { file_path: filePath } }

    // #when
    await hook["tool.execute.after"](input, output)

    // #then
    expect(output.output).toContain("[mdsel Reminder]")
  })

  test("gracefully handles non-existent files", async () => {
    // #given - a file that doesn't exist
    const filePath = join(testDir, "nonexistent.md")

    const input = { tool: "Read", sessionID: "ses_123", callID: "call_456" }
    const output = { title: "Read", output: "error", metadata: {}, args: { filePath } }

    // #when - should not throw
    await hook["tool.execute.after"](input, output)

    // #then
    expect(output.output).not.toContain("[mdsel Reminder]")
  })

  test("gracefully handles missing args", async () => {
    // #given - no args
    const input = { tool: "Read", sessionID: "ses_123", callID: "call_456" }
    const output = { title: "Read", output: "content", metadata: {} }

    // #when - should not throw
    await hook["tool.execute.after"](input, output as never)

    // #then
    expect(output.output).not.toContain("[mdsel Reminder]")
  })
})
