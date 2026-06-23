import type { EpistemicState } from "./types"

export interface ResurrectionInput {
  currentState: EpistemicState
  exclusionTheoryHash: string | undefined
  currentTheoryHash: string
}

export interface ResurrectionOutput {
  shouldResurrect: boolean
}

export function checkResurrection(input: ResurrectionInput): ResurrectionOutput {
  const { currentState, exclusionTheoryHash, currentTheoryHash } = input

  if (currentState !== "excluded") {
    return { shouldResurrect: false }
  }

  if (exclusionTheoryHash === undefined || exclusionTheoryHash === "") {
    return { shouldResurrect: false }
  }

  if (currentTheoryHash === "") {
    return { shouldResurrect: false }
  }

  return { shouldResurrect: currentTheoryHash !== exclusionTheoryHash }
}
