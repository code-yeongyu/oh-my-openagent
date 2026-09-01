import { readFileSync } from "node:fs"
import { basename } from "node:path"
import { parseFrontmatter } from "@oh-my-opencode/utils"

import { RawAgentDefinitionSchema, normalizeAgentDefinition } from "./schema"
import type { AgentDefinition, AgentLoaderDiagnostic } from "./types"

type ParseMarkdownAgentResult =
  | { readonly ok: true; readonly agent: AgentDefinition }
  | { readonly ok: false; readonly diagnostic: AgentLoaderDiagnostic }

export function loadMarkdownAgent(path: string): ParseMarkdownAgentResult {
  let content: string
  try {
    content = readFileSync(path, "utf8")
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return {
      ok: false,
      diagnostic: { kind: "read", path, message: `Failed to read ${path}: ${error.message}` },
    }
  }

  const parsed = parseFrontmatter(content)
  if (parsed.parseError) {
    return {
      ok: false,
      diagnostic: { kind: "frontmatter", path, message: `Malformed YAML frontmatter in ${path}` },
    }
  }

  const validation = RawAgentDefinitionSchema.safeParse(parsed.data)
  if (!validation.success) {
    const issuePaths = validation.error.issues.map((issue) => issue.path.map((part) => String(part)).join("."))
    return {
      ok: false,
      diagnostic: {
        kind: "validation",
        path,
        message: `Invalid agent frontmatter in ${path}: ${issuePaths.join(", ")}`,
        issuePaths,
      },
    }
  }

  return {
    ok: true,
    agent: normalizeAgentDefinition(agentNameFromPath(path), validation.data, parsed.body),
  }
}

function agentNameFromPath(path: string): string {
  return basename(path, ".md")
}
