import type { RecallCandidate, RecallDocument } from "@oh-my-opencode/memory-core"

/** One touched project's qualified notes, plus the touched file relative to that project's root. */
export interface ProjectRecallCorpus {
  readonly documents: readonly RecallDocument[]
  readonly touchedPath?: string
}

export type RankCorpus = (documents: readonly RecallDocument[], extraQueries: readonly string[]) => readonly RecallCandidate[]

/**
 * The session's own notes and each touched project's notes are ranked separately (#10044). Merging
 * them into one corpus changed the own ranking (strategy choice and term weights depend on the
 * corpus) and gave a 12-note project no seat against thousands of own notes. Projects get up to
 * half the seats, rounded up, in touch order; seats one side cannot fill go to the other.
 */
export function selectWithProjectSeats(
  own: readonly RecallDocument[],
  projects: readonly ProjectRecallCorpus[],
  maxItems: number,
  rank: RankCorpus,
): RecallCandidate[] {
  const ownRanked = own.length === 0 ? [] : rank(own, [])
  if (projects.length === 0 || maxItems <= 0) return ownRanked.slice(0, Math.max(0, maxItems))
  const projectRanked = interleave(projects.map((project) =>
    project.documents.length === 0 ? [] : rank(project.documents, project.touchedPath === undefined ? [] : [project.touchedPath])))
  const projectSeats = Math.min(Math.ceil(maxItems / 2), projectRanked.length)
  const ownTaken = ownRanked.slice(0, maxItems - projectSeats)
  const projectTaken = projectRanked.slice(0, maxItems - ownTaken.length)
  return [...ownTaken, ...projectTaken]
}

function interleave(lists: readonly (readonly RecallCandidate[])[]): RecallCandidate[] {
  const out: RecallCandidate[] = []
  const seen = new Set<string>()
  for (let index = 0; lists.some((list) => index < list.length); index += 1) {
    for (const list of lists) {
      const candidate = list[index]
      if (candidate === undefined || seen.has(candidate.path)) continue
      seen.add(candidate.path)
      out.push(candidate)
    }
  }
  return out
}
