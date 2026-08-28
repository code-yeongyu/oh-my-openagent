import { extractApplyPatchEdits } from "@oh-my-opencode/comment-checker-core"

export const MUTATION_TOOL_NAMES = new Set(["write", "edit", "apply_patch"])

export interface PostMutationEvent {
  readonly toolName: string
  readonly input: Record<string, unknown>
  readonly details?: unknown
}

export function extractMutatedFilePaths(event: PostMutationEvent): string[] {
  const paths = new Set<string>()
  const add = (value: unknown) => { if (typeof value === "string" && value) paths.add(value) }
  const addArray = (value: unknown) => { if (Array.isArray(value)) value.forEach(add) }
  add(event.input.path); add(event.input.filePath); addArray(event.input.paths); addArray(event.input.filePaths)
  for (const edit of extractApplyPatchEdits(event.details, event.input)) add(edit.filePath)
  if (typeof event.input.input === "string") {
    for (const line of event.input.input.split(/\r?\n/)) {
      for (const prefix of ["*** Add File: ", "*** Update File: ", "*** Move to: "]) {
        if (line.startsWith(prefix)) add(line.slice(prefix.length).trim())
      }
    }
  }
  for (const key of ["files", "changes"]) {
    const value = event.input[key]
    if (Array.isArray(value)) for (const item of value) if (typeof item === "object" && item) {
      const record = item as Record<string, unknown>
      add(record.path); add(record.filePath); add(record.movePath)
    }
  }
  return [...paths]
}

const flights = new Map<string, Promise<unknown>>()
export function runSingleFlight<T>(path: string, work: () => Promise<T>): Promise<T> {
  const existing = flights.get(path)
  if (existing) return existing as Promise<T>
  const current = work().finally(() => flights.delete(path))
  flights.set(path, current)
  return current
}

export function createPostMutationSessionState() {
  const notices = new Map<string, Set<string>>()
  return {
    shouldNotice(key: string, sessionId = "anonymous"): boolean {
      let set = notices.get(sessionId)
      if (!set) { set = new Set(); notices.set(sessionId, set) }
      if (set.has(key)) return false
      set.add(key); return true
    },
    reset(sessionId?: string): void { if (sessionId) notices.delete(sessionId) },
  }
}
