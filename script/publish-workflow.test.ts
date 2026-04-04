import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const workflowPaths = [
  new URL("../.github/workflows/ci.yml", import.meta.url),
  new URL("../.github/workflows/publish.yml", import.meta.url),
]

describe("test workflows", () => {
  test("use a single plain bun test step without isolated split hacks", () => {
    for (const workflowPath of workflowPaths) {
      // given
      const workflow = readFileSync(workflowPath, "utf8")

      // then
      expect(workflow).toContain("- name: Run tests")
      expect(workflow).toContain("run: bun test")
      expect(workflow).not.toContain("Run mock-heavy tests (isolated)")
      expect(workflow).not.toContain("Run remaining tests")
    }
  })
})
