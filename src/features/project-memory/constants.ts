import * as path from "node:path"

export const MEMORY_DIR_NAME = "memory"
export const FACTS_DIR_NAME = "facts"
export const PROPOSALS_DIR_NAME = "proposals"

export function getMemoryRoot(directory: string): string {
  return path.join(directory, ".omo", MEMORY_DIR_NAME)
}

export function getFactsDir(directory: string): string {
  return path.join(getMemoryRoot(directory), FACTS_DIR_NAME)
}

export function getProposalsDir(directory: string): string {
  return path.join(getMemoryRoot(directory), PROPOSALS_DIR_NAME)
}
