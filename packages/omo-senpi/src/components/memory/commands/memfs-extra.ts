// /memfs backup|restore|diff|tokens — thin git/filesystem wrappers.
//
// `diff` mirrors the letta CLI exit-2 semantics for a dirty tree by returning
// warning-level text; `tokens` is the bytes/4 system-prompt estimate.

import { createRepoBackup, listRepoBackups, restoreRepoBackup } from "./backup"
import { requireExistingRepo, type MemfsSubcommand } from "./memfs-shared"
import { runGit } from "./repo"
import { estimateSystemTokens } from "./tokens"
import { isInteractive, respond } from "./types"

export const memfsBackup: MemfsSubcommand = async ({ deps, ctx, identity }) => {
  const repo = requireExistingRepo(deps, identity)
  if (typeof repo === "string") return respond(ctx, repo, "error")

  const path = await createRepoBackup(deps, identity)
  return respond(ctx, `backup written to ${path}`)
}

export const memfsRestore: MemfsSubcommand = async ({ deps, ctx, parsed, identity }) => {
  const backups = await listRepoBackups(identity)
  if (backups.length === 0) {
    return respond(ctx, `no backups found for ${identity.identity} in ${identity.identityPaths.root}`, "error")
  }

  const requested = parsed.positionals[1]
  let name: string
  if (requested === undefined) {
    if (!isInteractive(ctx)) {
      return respond(
        ctx,
        `specify a backup name: /memfs restore <name>; available: ${backups.join(", ")}`,
        "error",
      )
    }
    const selected = await ctx.ui?.select?.("Restore memory backup", [...backups])
    if (selected === undefined) return respond(ctx, "restore cancelled; nothing changed")
    name = selected
  } else {
    name = requested
  }

  if (!backups.includes(name)) {
    return respond(ctx, `unknown backup: ${name}; available: ${backups.join(", ")}`, "error")
  }

  const result = await restoreRepoBackup(deps, identity, name)
  const safety = result.safetyBackup === undefined ? "" : `; safety backup at ${result.safetyBackup}`
  return respond(ctx, `restored ${result.restored} into ${identity.identityPaths.repo}${safety}`)
}

export const memfsDiff: MemfsSubcommand = async ({ deps, ctx, identity }) => {
  const repo = requireExistingRepo(deps, identity)
  if (typeof repo === "string") return respond(ctx, repo, "error")

  const result = await runGit(deps, repo.dir, ["diff"])
  if (result.code !== 0) {
    return respond(ctx, `git diff failed: ${result.stderr.trim() || `exit ${result.code}`}`, "error")
  }
  const diff = result.stdout.trim()
  if (diff.length === 0) return respond(ctx, "No changes.")
  return respond(ctx, `# Memfs diff: ${identity.identity}\n\n${diff}`, "warning")
}

export const memfsTokens: MemfsSubcommand = async ({ deps, ctx, identity }) => {
  const repo = requireExistingRepo(deps, identity)
  if (typeof repo === "string") return respond(ctx, repo, "error")

  const estimate = await estimateSystemTokens(repo.dir)
  const lines = [
    `# System prompt token estimate (bytes/4): ${identity.identity}`,
    `Total: ~${estimate.totalTokens} tokens (${estimate.totalBytes} bytes)`,
  ]
  if (estimate.files.length > 0) {
    lines.push("", "  tokens  path")
    for (const file of estimate.files) {
      lines.push(`  ${String(file.tokens).padStart(6)}  ${file.path}`)
    }
  }
  return respond(ctx, lines.join("\n"))
}
