import { spawn } from "node:child_process"
import { log } from "../../shared/logger"
import type { L1Capture } from "./window-state"

const HOOK_NAME = "skill-boomerang"

function formatToolCalls(toolCalls: L1Capture[]): string {
  if (toolCalls.length === 0) return "(no tool calls captured)"
  return toolCalls.map((c) => `${c.tool}(${c.target})`).join(", ")
}

export function writeBoomerang(args: {
  skillName: string
  memoryTags: string[]
  toolCalls: L1Capture[]
  sessionID: string
}): void {
  const cli = process.env.NOUS_MEMORY_CLI
  if (!cli) return

  const { skillName, memoryTags, toolCalls, sessionID } = args
  const content = `Skill "${skillName}" used. Tools: ${formatToolCalls(toolCalls)}`
  const tags = ["skill-boomerang", skillName, ...memoryTags].join(",")

  const proc = spawn(cli, ["capture", "--type", "observation", "--scope", "skill-usage", "--tags", tags, content], {
    detached: true,
    stdio: "ignore",
  })

  proc.unref()
  proc.on("error", (err) => {
    log(`[${HOOK_NAME}] Failed to write boomerang`, { skillName, sessionID, error: String(err) })
  })
}
