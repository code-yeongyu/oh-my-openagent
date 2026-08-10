export interface MemoryModuleSupervisor {
  readonly refCount: number
  acquire(): void
  release(): void
}

let references = 0

// Placeholder shared lifecycle for todo 23's detached reflection completion supervisor.
export const memoryModuleSupervisor: MemoryModuleSupervisor = {
  get refCount(): number {
    return references
  },
  acquire(): void {
    references += 1
  },
  release(): void {
    references = Math.max(0, references - 1)
  },
}
