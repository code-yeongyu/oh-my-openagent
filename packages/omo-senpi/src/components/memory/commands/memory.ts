// /memory — committed memory tree and file viewer.
//
// Default view is the committed HEAD content; working-tree changes render in a
// visually separate section (ultrabrain sec9). Output is read-only and never
// enters model context.

import { parseMemoryFile, type GitMemoryRepo } from "@oh-my-opencode/memory-core"

import type { SenpiExtensionAPI } from "../../../extension/types"
import { hasGitRepo, openRepo, shortSha } from "./repo"
import { requireIdentity, respond, type MemoryCommandContext, type MemoryCommandDeps } from "./types"

function isSystemMarkdown(path: string): boolean {
  return path.startsWith("system/") && path.endsWith(".md")
}

function isSkillPath(path: string): boolean {
  return path.startsWith("skills/")
}

async function renderSystemSection(repo: GitMemoryRepo, head: string, paths: readonly string[]): Promise<string[]> {
  const systemPaths = paths.filter(isSystemMarkdown).sort((left, right) => left.localeCompare(right))
  if (systemPaths.length === 0) return ["## System memory (committed)", "", "_no system memory files committed_"]

  const lines = ["## System memory (committed)"]
  for (const path of systemPaths) {
    const raw = await repo.show(head, path)
    let heading = `### ${path}`
    let body = raw
    try {
      const parsed = parseMemoryFile(raw)
      heading = `### ${path} — ${parsed.frontmatter.description}`
      body = parsed.body
    } catch {
      heading = `### ${path} — (invalid frontmatter)`
    }
    lines.push("", heading, "", body.trimEnd())
  }
  return lines
}

function renderNameSection(title: string, paths: readonly string[]): string[] {
  if (paths.length === 0) return []
  const sorted = [...paths].sort((left, right) => left.localeCompare(right))
  return ["", `## ${title}`, ...sorted.map((path) => `- ${path}`)]
}

export function registerMemoryCommand(pi: SenpiExtensionAPI, deps: MemoryCommandDeps): void {
  pi.registerCommand("memory", {
    description: "View committed memory: HEAD, system bodies, external names, and uncommitted changes.",
    argumentHint: "",
    handler: async (_args: string, ctx: MemoryCommandContext): Promise<string> => {
      const identity = requireIdentity(deps, ctx)
      if (typeof identity === "string") return respond(ctx, identity, "error")

      if (!hasGitRepo(identity)) {
        return respond(
          ctx,
          `no memory repository for ${identity.identity} at ${identity.identityPaths.repo}; run /memfs init or /init to create one`,
          "error",
        )
      }

      const repo = openRepo(deps, identity)
      const head = await repo.head()
      if (head === null) {
        return respond(ctx, `memory repository at ${identity.identityPaths.repo} has no commits yet; run /init`, "error")
      }

      const porcelain = (await repo.status()).split(/\r?\n/).filter((line) => line.trim().length > 0)
      const paths = await repo.lsTree(head)
      const externalPaths = paths.filter((path) => !isSystemMarkdown(path) && !isSkillPath(path))

      const lines = [
        `# Memory: ${identity.identity}`,
        `HEAD: ${shortSha(head)} (${porcelain.length === 0 ? "clean" : `dirty — ${porcelain.length} entr${porcelain.length === 1 ? "y" : "ies"}`})`,
        `Repository: ${identity.identityPaths.repo}`,
        "",
        ...(await renderSystemSection(repo, head, paths)),
        ...renderNameSection("External memory (committed)", externalPaths),
        ...renderNameSection("Skills (committed)", paths.filter(isSkillPath)),
      ]

      if (porcelain.length > 0) {
        lines.push("", "## Uncommitted changes", ...porcelain)
      }

      return respond(ctx, lines.join("\n"))
    },
  })
}
