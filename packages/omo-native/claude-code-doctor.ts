import { existsSync } from "node:fs"
import { join } from "node:path"
import { finding } from "./bin/lib/diagnostics-findings.js"
import type { DiagnosticFinding } from "./bin/lib/diagnostics-contract"
import { cachedExecutablePath } from "../omo-senpi/src/components/claude-code/acquire"
import { findOnPath } from "../omo-senpi/src/components/claude-code/find-on-path"
import { readClaudeCodePin } from "../omo-senpi/src/components/claude-code/index"

export function claudeCodeFindings(input: {
  readonly runtimeDir: string
  readonly env: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly which?: (command: string) => string | null
}): DiagnosticFinding[] {
  const pin = readClaudeCodePin(input.runtimeDir)
  if (pin === undefined) return []
  const version = pin.claudeCodeVersion ?? pin.version
  if (input.env.CLAUDE_CODE_EXECUTABLE)
    return [
      finding("claude-code", "notice", `Claude Code: CLAUDE_CODE_EXECUTABLE=${input.env.CLAUDE_CODE_EXECUTABLE}`, {
        source: "env",
        path: input.env.CLAUDE_CODE_EXECUTABLE,
      }),
    ]
  const onPath = (input.which ?? ((command: string) => findOnPath(command, input.env)))("claude")
  if (onPath !== null)
    return [finding("claude-code", "notice", `Claude Code: ${onPath} (on PATH)`, { source: "path", path: onPath })]
  const cached = cachedExecutablePath(join(input.runtimeDir, "claude-code"), pin, input.platform ?? process.platform)
  if (existsSync(cached))
    return [
      finding("claude-code", "ok", `Claude Code ${version}: ${cached}`, { source: "cache", path: cached, version }),
    ]
  return [
    finding(
      "claude-code",
      "notice",
      `Claude Code ${version}: not downloaded yet; it is fetched (integrity-checked) on the first anthropic-subscription turn`,
      { source: "none", version },
    ),
  ]
}
