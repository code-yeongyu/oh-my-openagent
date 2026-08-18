import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveRoster } from "../../../packages/omo-opencode/src/features/tui-sidebar/roster-resolver"

const root = join(tmpdir(), `omo-issue-6866-${Date.now()}`)
const project = join(root, "project")
const configDir = join(project, ".omo")

try {
  mkdirSync(configDir, { recursive: true })
  process.env.HOME = root
  process.env.OPENCODE_CONFIG_DIR = join(root, "opencode")
  process.env.XDG_CONFIG_HOME = join(root, "xdg")
  writeFileSync(
    join(configDir, "omo.jsonc"),
    `${JSON.stringify({ "[opencode]": { disabled_agents: ["Sisyphus"] } }, null, 2)}\n`,
    "utf-8",
  )

  const rows = resolveRoster(project)
  const result = {
    disabledAgentPresent: rows.some((row) => row.label === "sisyphus"),
    enabledAgentPresent: rows.some((row) => row.label === "oracle"),
    categoryPresent: rows.some((row) => row.label === "deep"),
  }

  console.log(JSON.stringify(result, null, 2))
  if (result.disabledAgentPresent || !result.enabledAgentPresent || !result.categoryPresent) {
    process.exitCode = 1
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}
