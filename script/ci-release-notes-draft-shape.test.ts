/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

interface Step {
  name?: string
  env?: Record<string, unknown>
  run?: string
}

interface Workflow {
  jobs?: Record<string, { steps?: Step[] }>
}

const workflowText = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n",
)
const workflow = Bun.YAML.parse(workflowText) as Workflow

describe("ci.yml draft release notes", () => {
  test("pins the private-name deny list and its fail-closed flag on every step that generates notes", () => {
    const steps = Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? [])
    const generating = steps.filter((step) => (step.run ?? "").includes("script/generate-changelog.ts"))
    expect(generating.length).toBeGreaterThan(0)
    for (const step of generating) {
      expect(step.env?.RELEASE_NOTES_PRIVATE_NAMES).toBe("${{ secrets.RELEASE_NOTES_PRIVATE_NAMES }}")
      expect(step.env?.CI_RELEASE_NOTES_REQUIRE_DENY).toBe("1")
    }
  })
})
