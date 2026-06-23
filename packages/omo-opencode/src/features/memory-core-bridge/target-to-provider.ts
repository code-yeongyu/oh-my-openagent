import type { MemoryTarget } from "../claude-tasks/memory-work-item"

export type MemoryProviderName = "claude-mem" | "mem0" | "corpus-ingestor" | "obsidian"

export function memoryTargetToProviderName(target: MemoryTarget): MemoryProviderName {
  switch (target) {
    case "l1":
      return "claude-mem"
    case "l2":
      return "mem0"
    case "l3":
      return "corpus-ingestor"
  }
}
