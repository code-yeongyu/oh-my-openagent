import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { formatLoadedCommand } from "../../../packages/omo-opencode/src/tools/slashcommand/command-output-formatter"
import type { CommandInfo } from "../../../packages/omo-opencode/src/tools/slashcommand/types"

// Isolated fixture dir with ONE real reference target, so we prove real @file inlining still works.
const dir = join(tmpdir(), `omo-5978-driver-${Date.now()}`)
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, "steps.md"), "REAL-STEP-ONE / REAL-STEP-TWO", "utf8")

// Mirror the reported /start-work skill wrapper header (issue #5978): a literal (@path) note,
// literal @ts-ignore / @ts-expect-error prose, an install path containing @latest, plus a REAL @steps.md ref.
const command: CommandInfo = {
  name: "start-work",
  path: join(dir, "start-work.md"),
  metadata: { name: "start-work", description: "Execute a Prometheus work plan" },
  content: [
    "Base directory for this skill: /Users/dev/.cache/opencode/packages/oh-my-openagent@latest/skills/start-work/",
    "File references (@path) in this skill are relative to this directory.",
    "Never use @ts-ignore or @ts-expect-error in code.",
    "Load @steps.md for the checklist.",
  ].join("\n"),
  scope: "plugin",
}

const output = await formatLoadedCommand(command)
console.log("===== RENDERED /start-work WRAPPER =====")
console.log(output)
console.log("===== ASSERTIONS =====")
const corruptCount = (output.match(/\[file not found:/g) ?? []).length
console.log(`[file not found: fragments  = ${corruptCount}  (expect 0 after fix)`)
console.log(`contains literal "(@path)"   = ${output.includes("(@path)")}  (expect true)`)
console.log(`contains literal "@ts-ignore"= ${output.includes("@ts-ignore")}  (expect true)`)
console.log(`contains "@latest"            = ${output.includes("@latest")}  (expect true, install path intact)`)
console.log(`real @steps.md inlined        = ${output.includes("REAL-STEP-ONE")}  (expect true, feature preserved)`)

rmSync(dir, { recursive: true, force: true })
