import { describe, expect, test } from "bun:test"

describe("measure-token-budget QA script", () => {
  test("#given compact mode #when script runs #then it records before and after sizes", () => {
    // given
    const command = ["bun", "script/qa/measure-token-budget.ts", "--mode", "compact"]

    // when
    const result = Bun.spawnSync(command, {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    })
    const stdout = result.stdout.toString()

    // then
    expect(result.exitCode).toBe(0)
    expect(stdout).toContain("mode: compact")
    expect(stdout).toContain("skill_description:")
    expect(stdout).toContain("tool_payload:")
    expect(stdout).toContain("full_bytes:")
    expect(stdout).toContain("compact_bytes:")
    expect(stdout).toContain("tool_required_schema_keys_unchanged: true")
  })
})
