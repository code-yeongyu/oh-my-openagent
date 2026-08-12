// /memfs <status|init|sync|repair|reset|backup|restore|diff|tokens>
//
// Thin harness-neutral wrappers over the memory-core git substrate. Dirty state
// on status (letta CLI exit 2) surfaces as warning-level text. `reset` is the
// only destructive path: it requires confirmation (interactive) or --force
// (noninteractive) and ALWAYS writes a backup before replacing the repository.

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { rm } from "node:fs/promises"

import { MirrorSync, installHooks } from "@oh-my-opencode/memory-core"

import type { SenpiExtensionAPI } from "../../../extension/types"
import { parseCommandArgs } from "./args"
import { createRepoBackup } from "./backup"
import { memfsBackup, memfsDiff, memfsRestore, memfsTokens } from "./memfs-extra"
import { requireExistingRepo, type MemfsSubcommand, type MemfsSubcommandInput } from "./memfs-shared"
import {
  formatSkillNameFrontmatterRepairReport,
  repairMissingSkillNameFrontmatter,
} from "./skill-frontmatter"
import { hasGitRepo, openRepo, shortSha } from "./repo"
import {
  identityForInit,
  isInteractive,
  requireIdentity,
  respond,
  type MemoryCommandContext,
  type MemoryCommandDeps,
} from "./types"

const SUBCOMMANDS = ["status", "init", "sync", "repair", "reset", "backup", "restore", "diff", "tokens"] as const

const memfsStatus: MemfsSubcommand = async ({ deps, ctx, identity }) => {
  const repo = requireExistingRepo(deps, identity)
  if (typeof repo === "string") return respond(ctx, repo, "error")

  const head = await repo.head()
  const porcelain = (await repo.status()).split(/\r?\n/).filter((line) => line.trim().length > 0)
  const mirror = await new MirrorSync({ repo, ...(deps.exec === undefined ? {} : { exec: deps.exec }) }).status()
  const dirty = porcelain.length > 0

  const lines = [
    `# Memfs status: ${identity.identity}`,
    `Repository: ${identity.identityPaths.repo}`,
    `HEAD: ${head === null ? "(no commits)" : shortSha(head)}`,
    `Working tree: ${dirty ? `dirty — ${porcelain.length} entr${porcelain.length === 1 ? "y" : "ies"}` : "clean"}`,
    `Mirror: ${mirror.redactedUrl ?? "not configured"}${mirror.url === undefined ? "" : ` (${mirror.aheadCount} ahead)`}`,
  ]
  if (dirty) {
    lines.push("", ...porcelain, "", "uncommitted changes present; inspect with /memfs diff or commit through the memory tools")
  }
  const skillsBlock = await renderSkillsUsage(identity.identityPaths.runtime)
  if (skillsBlock !== undefined) lines.push(skillsBlock)
  return respond(ctx, lines.join("\n"), dirty ? "warning" : "info")
}

const memfsInit: MemfsSubcommand = async ({ deps, ctx, identity }) => {
  if (hasGitRepo(identity)) {
    const head = await openRepo(deps, identity).head()
    return respond(
      ctx,
      `memory repository already initialized at ${identity.identityPaths.repo}${head === null ? "" : ` (HEAD ${shortSha(head)})`}`,
    )
  }
  const sha = await openRepo(deps, identity).init()
  return respond(ctx, `initialized memory repository at ${identity.identityPaths.repo} (HEAD ${shortSha(sha)})`)
}

const memfsSync: MemfsSubcommand = async ({ deps, ctx, identity }) => {
  const repo = requireExistingRepo(deps, identity)
  if (typeof repo === "string") return respond(ctx, repo, "error")

  const mirror = new MirrorSync({ repo, ...(deps.exec === undefined ? {} : { exec: deps.exec }) })
  const status = await mirror.status()
  if (status.url === undefined) {
    return respond(
      ctx,
      "no memory repository mirror configured; set one with /memory-repository set <url>",
      "error",
    )
  }
  const result = await mirror.pushNow()
  if (!result.pushed) return respond(ctx, `push to ${status.redactedUrl} failed: ${result.detail}`, "error")
  return respond(ctx, `pushed main to ${status.redactedUrl}`)
}

const memfsRepair: MemfsSubcommand = async ({ deps, ctx, identity }) => {
  const repo = requireExistingRepo(deps, identity)
  if (typeof repo === "string") return respond(ctx, repo, "error")

  const hooks = installHooks(repo.dir)
  const repaired = await repairMissingSkillNameFrontmatter(repo.dir)
  const report = formatSkillNameFrontmatterRepairReport(repaired)
  const lines = [
    `# Memfs repair: ${identity.identity}`,
    `- reinstalled ${hooks.length} git hook${hooks.length === 1 ? "" : "s"}`,
    `- scanned ${repaired.scanned} skill file${repaired.scanned === 1 ? "" : "s"}`,
  ]
  if (report.length > 0) lines.push(...report.split("\n").map((line) => `- ${line}`))
  return respond(ctx, lines.join("\n"))
}

const memfsReset: MemfsSubcommand = async ({ deps, ctx, parsed, identity }) => {
  const existing = requireExistingRepo(deps, identity)
  if (typeof existing === "string") return respond(ctx, existing, "error")

  if (isInteractive(ctx)) {
    const confirmed = await ctx.ui?.confirm?.(
      "Reset memory repository",
      `This deletes ${identity.identityPaths.repo} and starts an empty history. A backup is written first.`,
    )
    if (confirmed !== true) return respond(ctx, "reset aborted; nothing changed")
  } else if (parsed.flags.get("force") !== true) {
    return respond(
      ctx,
      "reset requires --force in a noninteractive session (no confirmation UI available): /memfs reset --force",
      "error",
    )
  }

  const backup = await createRepoBackup(deps, identity)
  await rm(identity.identityPaths.repo, { recursive: true, force: true })
  const sha = await openRepo(deps, identity).init()
  return respond(ctx, `reset complete; backup at ${backup}; new HEAD ${shortSha(sha)}`)
}

const SKILLS_USAGE_FILENAME = "skills-usage.json"

async function renderSkillsUsage(runtimeDir: string): Promise<string | undefined> {
  let content: string
  try {
    content = await readFile(join(runtimeDir, SKILLS_USAGE_FILENAME), "utf8")
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
  const entries = Object.entries(parsed as Record<string, unknown>)
  if (entries.length === 0) return undefined
  const lines = ["", "## Skills usage"]
  for (const [skillId, value] of entries) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue
    const entry = value as Record<string, unknown>
    const count = typeof entry.count === "number" ? entry.count : 0
    const lastUsedAt = typeof entry.lastUsedAt === "string" ? entry.lastUsedAt : "unknown"
    lines.push(`  ${skillId}: ${count} read${count === 1 ? "" : "s"}, last ${lastUsedAt}`)
  }
  return lines.length > 2 ? lines.join("\n") : undefined
}

const HANDLERS: Record<string, MemfsSubcommand> = {
  status: memfsStatus,
  init: memfsInit,
  sync: memfsSync,
  repair: memfsRepair,
  reset: memfsReset,
  backup: memfsBackup,
  restore: memfsRestore,
  diff: memfsDiff,
  tokens: memfsTokens,
}

export function registerMemfsCommand(pi: SenpiExtensionAPI, deps: MemoryCommandDeps): void {
  pi.registerCommand("memfs", {
    description: "Inspect and maintain the memory filesystem repository.",
    argumentHint: `<${SUBCOMMANDS.join("|")}>`,
    handler: async (args: string, ctx: MemoryCommandContext): Promise<string> => {
      const parsed = parseCommandArgs(args, { booleans: ["force"] })
      const [subcommand] = parsed.positionals
      if (subcommand === undefined) {
        return respond(ctx, `usage: /memfs <${SUBCOMMANDS.join("|")}>`, "error")
      }
      const handler = HANDLERS[subcommand]
      if (handler === undefined) {
        return respond(
          ctx,
          `unknown /memfs subcommand: ${subcommand}; expected one of ${SUBCOMMANDS.join(", ")}`,
          "error",
        )
      }

      const identity = subcommand === "init" ? identityForInit(deps, ctx) : requireIdentity(deps, ctx)
      if (identity === undefined) {
        return respond(ctx, "no memory identity resolved; check the memory config for this project", "error")
      }
      if (typeof identity === "string") return respond(ctx, identity, "error")

      const input: MemfsSubcommandInput = { deps, ctx, parsed, identity }
      return handler(input)
    },
  })
}
