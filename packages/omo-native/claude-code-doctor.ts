import { existsSync } from "node:fs"
import { join } from "node:path"
import { cachedExecutablePath } from "../omo-senpi/src/components/claude-code/acquire"
import { findOnPath } from "../omo-senpi/src/components/claude-code/find-on-path"
import { readClaudeCodePin } from "../omo-senpi/src/components/claude-code/index"

export function claudeCodeDoctorLines(input: {
  readonly runtimeDir: string
  readonly env: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly which?: (command: string) => string | null
}): string[] {
  const pin = readClaudeCodePin(input.runtimeDir)
  if (pin === undefined) return []
  const version = pin.claudeCodeVersion ?? pin.version
  if (input.env.CLAUDE_CODE_EXECUTABLE) return [`INFO Claude Code: CLAUDE_CODE_EXECUTABLE=${input.env.CLAUDE_CODE_EXECUTABLE}`]
  const onPath = (input.which ?? ((command: string) => findOnPath(command, input.env)))("claude")
  if (onPath !== null) return [`INFO Claude Code: ${onPath} (on PATH)`]
  const cached = cachedExecutablePath(join(input.runtimeDir, "claude-code"), pin, input.platform ?? process.platform)
  if (existsSync(cached)) return [`PASS Claude Code ${version}: ${cached}`]
  return [`INFO Claude Code ${version}: not downloaded yet; it is fetched (integrity-checked) on the first anthropic-subscription turn`]
}
