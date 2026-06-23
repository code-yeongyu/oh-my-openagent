import type { CanonicalMemory } from "../memory-core/types"

export type SignalThreshold = "low" | "medium" | "high"

export interface SignalDetectorConfig {
  threshold: SignalThreshold
  minimumObservationsForCluster: number
}

export const DEFAULT_SIGNAL_DETECTOR_CONFIG: SignalDetectorConfig = {
  threshold: "high",
  minimumObservationsForCluster: 3,
}

export interface MemoryCluster {
  cluster_key: string
  memories: CanonicalMemory[]
  score: number
  reason: string
}

export function detectDistillationSignal(
  memories: CanonicalMemory[],
  config: SignalDetectorConfig = DEFAULT_SIGNAL_DETECTOR_CONFIG,
): MemoryCluster[] {
  const clusters = clusterMemories(memories, config.minimumObservationsForCluster)
  const threshold = scoreThreshold(config.threshold)
  return clusters.filter((c) => c.score >= threshold)
}

function clusterMemories(
  memories: CanonicalMemory[],
  minCluster: number,
): MemoryCluster[] {
  const clusters = new Map<string, CanonicalMemory[]>()

  for (const memory of memories) {
    const keys = keysForMemory(memory)
    for (const key of keys) {
      const bucket = clusters.get(key) ?? []
      bucket.push(memory)
      clusters.set(key, bucket)
    }
  }

  const results: MemoryCluster[] = []
  for (const [key, group] of clusters) {
    const uniqueIds = new Set(group.map((m) => m.memory_id))
    if (uniqueIds.size < minCluster && !isHighValueCluster(key, group)) continue

    const deduped = Array.from(uniqueIds)
      .map((id) => group.find((m) => m.memory_id === id))
      .filter((m): m is CanonicalMemory => m !== undefined)

    results.push({
      cluster_key: key,
      memories: deduped,
      score: scoreCluster(key, deduped),
      reason: reasonForCluster(key, deduped),
    })
  }

  results.sort((a, b) => b.score - a.score)
  return dedupeClustersByMemberOverlap(results)
}

function keysForMemory(memory: CanonicalMemory): string[] {
  const keys: string[] = []
  if (memory.source_refs.commit_sha) keys.push(`commit:${memory.source_refs.commit_sha}`)
  if (memory.source_refs.url) keys.push(`url:${memory.source_refs.url}`)
  if (memory.memory_type === "decision") keys.push(`type:decision:${memory.project_id}`)
  if (memory.memory_type === "convention") keys.push(`type:convention:${memory.project_id}`)
  if (memory.memory_type === "rule") keys.push(`type:rule:${memory.project_id}`)
  if (memory.memory_type === "bugfix") keys.push(`type:bugfix:${memory.project_id}`)
  const primaryTag = memory.tags[0]
  if (primaryTag) keys.push(`tag:${memory.project_id}:${primaryTag}`)
  return keys
}

function isHighValueCluster(key: string, memories: CanonicalMemory[]): boolean {
  if (key.startsWith("commit:")) return memories.length >= 1
  if (key.startsWith("type:decision:") || key.startsWith("type:rule:") || key.startsWith("type:bugfix:")) return memories.length >= 1
  if (key.startsWith("url:")) return memories.length >= 1
  return false
}

function scoreCluster(key: string, memories: CanonicalMemory[]): number {
  const avgConfidence = memories.reduce((sum, m) => sum + m.confidence, 0) / memories.length
  const sizeBonus = Math.min(memories.length / 5, 1)
  const typeBonus = memories.some((m) => m.memory_type === "decision" || m.memory_type === "bugfix" || m.memory_type === "rule") ? 0.25 : 0
  const commitBonus = key.startsWith("commit:") ? 0.2 : 0
  const urlBonus = key.startsWith("url:") ? 0.15 : 0
  return Math.min(1, avgConfidence * 0.6 + sizeBonus * 0.2 + typeBonus + commitBonus + urlBonus)
}

function reasonForCluster(key: string, memories: CanonicalMemory[]): string {
  const [kind] = key.split(":")
  switch (kind) {
    case "commit":
      return `commit-bound cluster (${memories.length} memories share ${key})`
    case "url":
      return `external-source cluster (${memories.length} memories reference ${key})`
    case "type":
      return `${memories[0]?.memory_type ?? "typed"} cluster (${memories.length} memories)`
    case "tag":
      return `tag cluster (${memories.length} memories share ${key})`
    default:
      return `cluster ${key} (${memories.length} memories)`
  }
}

function scoreThreshold(threshold: SignalThreshold): number {
  switch (threshold) {
    case "low":
      return 0.4
    case "medium":
      return 0.6
    case "high":
      return 0.75
  }
}

function dedupeClustersByMemberOverlap(clusters: MemoryCluster[]): MemoryCluster[] {
  const seenIds = new Set<string>()
  const kept: MemoryCluster[] = []
  for (const cluster of clusters) {
    const clusterIds = cluster.memories.map((m) => m.memory_id)
    const novel = clusterIds.filter((id) => !seenIds.has(id))
    if (novel.length === 0) continue
    for (const id of clusterIds) seenIds.add(id)
    kept.push(cluster)
  }
  return kept
}
