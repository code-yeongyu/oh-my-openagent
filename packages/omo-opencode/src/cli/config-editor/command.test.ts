import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

function cli(...args: string[]) {
  return spawnSync(process.execPath, [resolve(import.meta.dir, "../index.ts"), ...args], { encoding: "utf-8", timeout: 30000 })
}

describe("config editor command", () => {
  test("lists edit and migrate as sibling config commands", () => {
    const result = cli("config", "--help")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("edit")
    expect(result.stdout).toContain("migrate")
  })

  test("offers explicit file and project discovery options", () => {
    const result = cli("config", "edit", "--help")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("--file")
    expect(result.stdout).toContain("--directory")
  })

  test("fails promptly with an actionable message when stdin is not a terminal", () => {
    const result = cli("config", "edit")
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("needs an interactive terminal")
  })
})
