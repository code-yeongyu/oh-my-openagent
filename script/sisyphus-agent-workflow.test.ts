import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const workflowPath = new URL("../.github/workflows/sisyphus-agent.yml", import.meta.url)

describe("Sisyphus Agent workflow", () => {
  test("runs weekly repository update maintenance from GitHub cron", () => {
    const workflow = readFileSync(workflowPath, "utf8")

    expect(workflow).toContain("schedule:")
    expect(workflow).toContain('cron: "23 6 * * 1"')
    expect(workflow).toContain("github.event_name == 'schedule'")
    expect(workflow).toContain("Weekly repository update")
    expect(workflow).toContain("Create a PR to the default branch when changes are needed.")
  })

  test("protects the default branch from scheduled direct commits and pushes", () => {
    const workflow = readFileSync(workflowPath, "utf8")

    expect(workflow).toContain('DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}')
    expect(workflow).toContain('"$BRANCH" == "$DEFAULT_BRANCH"')
    expect(workflow).toContain("Refusing to commit or push changes on protected/default branch")
    expect(workflow).toContain("Never push directly to `BRANCH_PLACEHOLDER`.")
  })
})
