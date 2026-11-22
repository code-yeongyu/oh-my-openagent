import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const workflowPath = join(import.meta.dir, "../../../../.github/workflows/computer-live-windows-full.yml")

function stepBlocks(workflow: string): { name: string; body: string }[] {
  const blocks: { name: string; body: string }[] = []
  for (const chunk of workflow.split(/\n(?=      - )/)) {
    const name = /^      - (?:name: (.+)|uses: (.+))$/m.exec(chunk)
    if (name === null) continue
    blocks.push({ name: (name[1] ?? name[2] ?? "").trim(), body: chunk })
  }
  return blocks
}

describe("computer-live-windows-full ledger job", () => {
  test("#given ledger drift #when the compare step fails #then the plan step has already written plan.json", () => {
    const steps = stepBlocks(readFileSync(workflowPath, "utf8"))
    const planIndex = steps.findIndex((step) => step.body.includes("windows-full.ts --plan"))
    const compareIndex = steps.findIndex((step) => step.body.includes("windows-full.ts --compare"))

    expect(planIndex).toBeGreaterThanOrEqual(0)
    expect(compareIndex).toBeGreaterThanOrEqual(0)
    expect(compareIndex).toBeGreaterThan(planIndex)
  })
})
