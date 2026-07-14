import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, test } from "bun:test"

const CHECKER_PATH = join(import.meta.dir, "check-no-excuse-rules.ts")

type CheckerResult = {
  readonly exitCode: number
  readonly output: string
}

function runChecker(source: string, relativePath = "prompt.test.ts"): CheckerResult {
  const directory = mkdtempSync(join(tmpdir(), "no-prose-assertion-"))
  const testFile = join(directory, relativePath)
  mkdirSync(dirname(testFile), { recursive: true })
  writeFileSync(testFile, source)

  try {
    const result = Bun.spawnSync({
      cmd: ["bun", "run", CHECKER_PATH, testFile],
      stdout: "pipe",
      stderr: "pipe",
    })
    return {
      exitCode: result.exitCode,
      output: `${result.stdout.toString()}${result.stderr.toString()}`,
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe("check-no-excuse-rules no-prose-assertion", () => {
  test("#given prose assertion matchers #when checked #then reports every prose assertion", () => {
    const source = [
      'expect(prompt).toContain("based on GPT-5.6")',
      'expect(prompt).toContain("You build context by examining")',
      'expect(prompt).not.toContain("Never chain together bash commands")',
      'expect(prompt).toMatch("Never chain together bash commands")',
      'expect(prompt).toBe("Never chain together bash commands in a prompt")',
      "expect(prompt).toMatchSnapshot()",
    ].join("\n")

    const result = runChecker(source)

    expect(result.exitCode).toBe(1)
    expect(result.output.match(/\[no-prose-assertion\]/g)).toHaveLength(6)
  })

  test("#given a __tests__ file #when checked #then reports a prose assertion", () => {
    const result = runChecker(
      'expect(prompt).toContain("You build context by examining")',
      "fixtures/__tests__/prompt.ts",
    )

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain("[no-prose-assertion]")
  })

  test("#given machine tokens #when checked #then accepts them", () => {
    const source = [
      'expect(prompt).toContain("<agent-identity>")',
      'expect(prompt).toContain("gpt-5-6")',
      'expect(prompt).toContain("packages/shared-skills/skills/programming/SKILL.md")',
      'expect(prompt).toContain("{\\"model\\":\\"gpt-5-6\\"}")',
      'expect(prompt).toContain("promptToken")',
      'expect(prompt).toMatch("<agent-identity>")',
      'expect(prompt).toBe("gpt-5-6")',
    ].join("\n")

    const result = runChecker(source)

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("No violations")
  })

  test("#given an explicit rule opt-out #when checked #then accepts the assertion", () => {
    const source = [
      'expect(prompt).toContain("You build context by examining") // no-excuse-ok: no-prose-assertion',
      "expect(prompt).toMatchSnapshot() // no-excuse-ok: no-prose-assertion",
    ].join("\n")

    const result = runChecker(source)

    expect(result.exitCode).toBe(0)
  })
})
