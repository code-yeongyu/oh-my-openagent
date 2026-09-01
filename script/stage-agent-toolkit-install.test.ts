import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const script = readFileSync(
  join(import.meta.dir, "..", "packages", "omo-senpi", "plugin", "scripts", "stage-agent-toolkit.mjs"),
  "utf8",
)

describe("stage-agent-toolkit install", () => {
  test("#given native staging runs concurrently #when the bundle is prepared #then it does not mutate or reinstall the shared dependency tree", () => {
    expect(script).not.toContain('run("npm", ["--prefix", "packages/omo-codex/plugin", "ci"])')
    expect(script).not.toContain("codexPluginNodeModules")
    expect(script).toContain('run("bun", [')
  })
})
