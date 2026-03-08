import { spawn } from "node:child_process"
import { log } from "../../shared/logger"

const MEMORY_CLI = "/workspace/brain/cli/omo-memory"
const HOOK_NAME = "skill-usage-tracker"

export function writeSkillUsage(args: {
  skillName: string
  sessionID: string
  memoryTags: string[]
}): void {
  const { skillName, sessionID, memoryTags } = args
  const content = `Skill "${skillName}" used in session ${sessionID}`
  const tags = ["skill-usage", skillName, ...memoryTags].join(",")

  const proc = spawn(MEMORY_CLI, [
    "capture",
    "--type", "observation",
    "--scope", "skill-usage",
    "--tags", tags,
    content,
  ], { detached: true, stdio: "ignore" })

  proc.unref()

  proc.on("error", (err) => {
    log(`[${HOOK_NAME}] Failed to write skill usage to memory`, { error: String(err) })
  })
}
