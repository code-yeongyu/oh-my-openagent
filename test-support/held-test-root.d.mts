export type SkippedTestRoot = {
  readonly root: string
  readonly code: string
  readonly holders: readonly { readonly pid: number; readonly image: string; readonly parentPid: number | null }[]
  readonly diagnosticErrors: readonly string[]
}
export const skippedTestRoots: Map<string, SkippedTestRoot>
export function removeTestRootBestEffort(root: string, options?: {
  readonly remove?: (root: string) => void
  readonly diagnose?: (root: string) => Pick<SkippedTestRoot, "holders" | "diagnosticErrors">
  readonly report?: (kind: string, record: string) => void
}): boolean
