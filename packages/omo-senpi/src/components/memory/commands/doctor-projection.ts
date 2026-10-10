import { GitMemoryRepo, externalProjectionStatsAt, type ExternalProjectionLimits } from "@oh-my-opencode/memory-core"

import type { DoctorCheck } from "./doctor-checks"

export async function checkProjection(
  repoDir: string,
  agentId: string,
  limits: ExternalProjectionLimits,
): Promise<DoctorCheck | undefined> {
  const repo = new GitMemoryRepo({ dir: repoDir, agentId })
  const head = await repo.head()
  if (head === null) return undefined
  const stats = await externalProjectionStatsAt(repo, head, limits)
  const perDirectory = limits.maxEntriesPerDirectory > 0 ? `${limits.maxEntriesPerDirectory}/dir` : "no per-directory limit"
  const bytes = limits.maxBytes > 0 ? `${limits.maxBytes} bytes` : "no byte limit"
  const ordered = stats.recencyUnavailable ? "; commit times unreadable, names listed in name order" : ""
  const detail = `${stats.shown} entries shown, ${stats.omitted} omitted, ${stats.bytes} bytes (limits ${perDirectory}, ${bytes})${ordered}`
  if (stats.overflow) {
    return { name: "projection", level: "warn", detail: `${detail}; no listing fits max_bytes, the smallest is ${stats.bytes - stats.maxBytes} bytes over` }
  }
  return { name: "projection", level: stats.omitted > 0 || stats.recencyUnavailable ? "warn" : "ok", detail }
}
