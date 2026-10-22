// /memory unlock <lock> — the way out of a kept stranded git lock (omo #10199). The command
// re-checks the one lock, shows what it found, and removes it only after the user confirms;
// --force skips the confirmation prompt only, it never overrides a refusal.

import { isAbsolute, join } from "node:path"

import { inspectStrandedGitLock, unlockStrandedGitLock, type UnlockFindings } from "@oh-my-opencode/memory-core"

import { isInteractive, respond, type MemoryCommandContext, type MemoryCommandIdentity } from "./types"

function pidList(pids: readonly number[] | null, unknown: string): string {
  if (pids === null) return unknown
  return pids.length === 0 ? "none" : pids.map(String).join(", ")
}

function describeWriter(writer: UnlockFindings["writer"]): string {
  switch (writer.kind) {
    case "none": return "none"
    case "alive": return `pid ${writer.pid}${writer.pid === process.pid ? " (this session's process)" : ""}`
    case "unknown": return "could not be determined on this system"
  }
}

function describeFindings(findings: UnlockFindings): string[] {
  return [
    `Lock: ${findings.lockPath}`,
    `- processes holding it open: ${pidList(findings.holders, "could not be determined on this system")}`,
    `- processes working in the repository: ${pidList(findings.repoUsers, "could not be determined on this system")}`,
    `- live memory writer: ${describeWriter(findings.writer)}`,
  ]
}

function refusal(findings: UnlockFindings): string {
  const reason = findings.writer.kind === "unknown"
    ? `Not removed: the memory writer could not be determined (its lock record ${findings.writerLockPath ?? ""} is unreadable, from another host, or its process cannot be checked). If no memory session is running, remove that record and run /memory unlock again.`
    : "Not removed: a live process is still using this lock. Let it finish (or stop it), then run /memory unlock again."
  return [...describeFindings(findings), "", reason].join("\n")
}

export async function runMemoryUnlock(
  ctx: MemoryCommandContext,
  identity: MemoryCommandIdentity,
  rawPath: string,
  force: boolean,
): Promise<string> {
  const repoDir = identity.identityPaths.repo
  if (rawPath.length === 0) return respond(ctx, "usage: /memory unlock <lock path> [--force]", "error")
  const lockPath = isAbsolute(rawPath) ? rawPath : join(repoDir, rawPath)

  const inspection = await inspectStrandedGitLock(repoDir, lockPath)
  if (inspection.kind === "not-a-git-lock") {
    return respond(ctx, `${lockPath} is not a git lock file of the memory repository at ${repoDir}; nothing was removed`, "error")
  }
  if (inspection.kind === "missing") return respond(ctx, `${lockPath} no longer exists; nothing to unlock`)
  if (inspection.verdict === "refuse") return respond(ctx, refusal(inspection), "error")

  const findings = describeFindings(inspection).join("\n")
  if (!force) {
    if (!isInteractive(ctx)) {
      return respond(ctx, `${findings}\n\nNo live process was found using this lock. Run /memory unlock ${inspection.lockPath} --force to remove it.`)
    }
    const confirmed = await ctx.ui?.confirm?.("Remove stranded git lock?", `${findings}\n\nRemove only if no git command or other session is working on this memory.`)
    if (confirmed !== true) return respond(ctx, `${inspection.lockPath} was kept; nothing was removed`)
  }

  const outcome = await unlockStrandedGitLock(repoDir, inspection)
  switch (outcome.kind) {
    case "removed":
      return respond(ctx, `Removed ${outcome.lockPath}. Retry the memory write.`)
    case "refused":
      return respond(ctx, refusal(outcome.inspection), "error")
    case "changed":
      return respond(ctx, `${outcome.lockPath} changed after it was checked (a git process took it again); it was kept. Run /memory unlock again once that process is done.`, "error")
    case "missing":
      return respond(ctx, `${lockPath} no longer exists; nothing to unlock`)
    case "not-a-git-lock":
      return respond(ctx, `${lockPath} is no longer a git lock file of the memory repository; nothing was removed`, "error")
    case "unlink-failed":
      return respond(ctx, `${outcome.lockPath} could not be removed: ${outcome.message}`, "error")
  }
}
