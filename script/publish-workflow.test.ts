/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const workflowChecks = [
  {
    path: new URL("../.github/workflows/ci.yml", import.meta.url),
    testRuns: [
      "run: bun test",
      "run: bun test src/shared/dist-bundle-bun-globals.test.ts",
    ],
  },
  {
    path: new URL("../.github/workflows/publish.yml", import.meta.url),
    testRuns: ["run: bun test"],
  },
]

describe("test workflows", () => {
  test("use pure bun test for workflows", () => {
    for (const workflowCheck of workflowChecks) {
      // #given
      const workflow = readFileSync(workflowCheck.path, "utf8")

      for (const testRun of workflowCheck.testRuns) {
        expect(workflow).toContain(testRun)
      }
    }
  })
})
