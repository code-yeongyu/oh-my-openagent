/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const workflowPaths = [
  new URL("../.github/workflows/ci.yml", import.meta.url),
  new URL("../.github/workflows/publish.yml", import.meta.url),
]

describe("test workflows", () => {
  test("use the CI-safe test runner for workflows", () => {
    for (const workflowPath of workflowPaths) {
      // given
      const workflow = readFileSync(workflowPath, "utf8")

      // then
      expect(workflow).toContain("- name: Run tests")
      expect(workflow).toContain("run: bun run test:ci")
    }
  })
})
