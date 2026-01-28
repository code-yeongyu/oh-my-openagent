import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { createBuiltinSkills } from "../skills"
import { createMdselReminderHook } from "../../../hooks/mdsel-reminder"
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { spawnSync } from "child_process"

describe("mdsel skill integration", () => {
  const testDir = join(tmpdir(), "mdsel-integration-test-" + Date.now())

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe("skill registration", () => {
    test("mdsel skill is included in builtin skills", () => {
      // #given
      const skills = createBuiltinSkills()

      // #when
      const mdselSkill = skills.find((s) => s.name === "mdsel")

      // #then
      expect(mdselSkill).toBeDefined()
      expect(mdselSkill?.description).toContain("Markdown")
      expect(mdselSkill?.description).toContain("token-efficient")
    })

    test("mdsel skill has valid template", () => {
      // #given
      const skills = createBuiltinSkills()
      const mdselSkill = skills.find((s) => s.name === "mdsel")

      // #then
      expect(mdselSkill?.template).toBeDefined()
      expect(mdselSkill?.template.length).toBeGreaterThan(100)
      expect(mdselSkill?.template).toContain("mdsel")
    })
  })

  describe("hook behavior", () => {
    test("hook triggers reminder for large .md files", async () => {
      // #given
      const filePath = join(testDir, "large-doc.md")
      const content = Array(300).fill("word").join(" ")
      writeFileSync(filePath, content)

      const hook = createMdselReminderHook({} as never)
      const callID = "call_test_" + Date.now()
      const input = { tool: "Read", sessionID: "ses_test", callID }
      const beforeOutput = { args: { filePath } }
      const afterOutput = { title: "Read", output: "content", metadata: {}, args: { filePath } }

      // #when - must call before first to register the pending call
      await hook["tool.execute.before"](input, beforeOutput)
      await hook["tool.execute.after"](input, afterOutput)

      // #then
      expect(afterOutput.output).toContain("[mdsel Reminder]")
      expect(afterOutput.output).toContain("300 words")
    })

    test("hook does not trigger for small .md files", async () => {
      // #given
      const filePath = join(testDir, "small-doc.md")
      const content = Array(50).fill("word").join(" ")
      writeFileSync(filePath, content)

      const hook = createMdselReminderHook({} as never)
      const input = { tool: "Read", sessionID: "ses_test", callID: "call_test" }
      const output = { title: "Read", output: "content", metadata: {}, args: { filePath } }

      // #when
      await hook["tool.execute.after"](input, output)

      // #then
      expect(output.output).not.toContain("[mdsel Reminder]")
    })

    test("hook does not trigger for non-.md files", async () => {
      // #given
      const filePath = join(testDir, "code.ts")
      const content = Array(500).fill("word").join(" ")
      writeFileSync(filePath, content)

      const hook = createMdselReminderHook({} as never)
      const input = { tool: "Read", sessionID: "ses_test", callID: "call_test" }
      const output = { title: "Read", output: "content", metadata: {}, args: { filePath } }

      // #when
      await hook["tool.execute.after"](input, output)

      // #then
      expect(output.output).not.toContain("[mdsel Reminder]")
    })
  })

  describe("CLI bundle", () => {
    const cliPath = join(__dirname, "cli.mjs")

    test("CLI bundle exists", () => {
      // #then
      expect(existsSync(cliPath)).toBe(true)
    })

    test("CLI bundle shows help", () => {
      // #when
      const result = spawnSync("node", [cliPath, "--help"], { encoding: "utf8" })

      // #then
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("mdsel")
      expect(result.stdout).toContain("Markdown")
    })

    test("CLI bundle indexes markdown files", () => {
      // #given
      const filePath = join(testDir, "test-doc.md")
      const content = `# Title\n\n## Section 1\n\nContent here.\n\n## Section 2\n\nMore content.`
      writeFileSync(filePath, content)

      // #when
      const result = spawnSync("node", [cliPath, filePath], { encoding: "utf8" })

      // #then
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("h1.0")
      expect(result.stdout).toContain("h2.0")
      expect(result.stdout).toContain("h2.1")
    })

    test("CLI bundle selects sections", () => {
      // #given
      const filePath = join(testDir, "select-doc.md")
      const content = `# Title\n\n## First Section\n\nFirst content.\n\n## Second Section\n\nSecond content.`
      writeFileSync(filePath, content)

      // #when
      const result = spawnSync("node", [cliPath, "h2.0", filePath], { encoding: "utf8" })

      // #then
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("First")
      expect(result.stdout).not.toContain("Second Section")
    })
  })
})
