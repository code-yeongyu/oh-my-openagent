import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseJsoncSafe } from "@oh-my-opencode/utils"
import { resolveOmoConfigPaths } from "@oh-my-opencode/omo-config-core"

import { OmoAgentOverlaySchema, normalizeAgentDefinition } from "./schema"
import type { AgentDefinition, AgentLoaderDiagnostic, LoadAgentsOptions } from "./types"

type OmoAgentOverlayResult = {
  readonly agents: readonly AgentDefinition[]
  readonly diagnostics: readonly AgentLoaderDiagnostic[]
}

export function loadOmoAgentOverlays(options: Required<LoadAgentsOptions>): OmoAgentOverlayResult {
  const agents: AgentDefinition[] = []
  const diagnostics: AgentLoaderDiagnostic[] = []
  const env = {
    ...process.env,
    APPDATA: join(options.homeDir, "AppData", "Roaming"),
    HOME: options.homeDir,
    USERPROFILE: options.homeDir,
    XDG_CONFIG_HOME: join(options.homeDir, ".config"),
  }

  for (const candidate of resolveOmoConfigPaths({ cwd: options.projectDir, env })) {
    if (!existsSync(candidate.path)) continue
    let content: string
    try {
      content = readFileSync(candidate.path, "utf8")
    } catch (error) {
      if (error instanceof Error) {
        diagnostics.push(readDiagnostic(candidate.path, error))
        continue
      }
      throw error
    }

    const parsed = parseJsoncSafe(content)
    if (parsed.errors.length > 0) {
      diagnostics.push({
        kind: "config_parse",
        path: candidate.path,
        message: `JSONC parse error in ${candidate.path}: ${parsed.errors.map((error) => error.message).join(", ")}`,
      })
      continue
    }

    const validation = OmoAgentOverlaySchema.safeParse(parsed.data)
    if (!validation.success) {
      const issuePaths = validation.error.issues.map((issue) => issue.path.map((part) => String(part)).join("."))
      diagnostics.push({
        kind: "validation",
        path: candidate.path,
        message: `Invalid omo agents config in ${candidate.path}: ${issuePaths.join(", ")}`,
        issuePaths,
      })
      continue
    }

    for (const [name, raw] of Object.entries(validation.data.agents ?? {})) {
      agents.push(normalizeAgentDefinition(name, raw, raw.prompt))
    }
  }

  return { agents, diagnostics }
}

function readDiagnostic(path: string, error: Error): AgentLoaderDiagnostic {
  const code = errorCode(error)
  const codeText = code === undefined ? "" : ` (${code})`
  return {
    kind: "read",
    path,
    message: `Failed to read omo agents config ${path}${codeText}: ${error.message}`,
  }
}

function errorCode(error: Error): string | undefined {
  if ("code" in error && typeof error.code === "string") return error.code
  return undefined
}
