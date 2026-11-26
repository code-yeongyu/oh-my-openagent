import { isReleaseStatePr } from "./release-pr-marker.ts"

/**
 * A release-state landing (#14818): when dev moved past a pinned release's stamp and touched a regenerated file, the
 * stamp PR cannot merge itself, so a separate PR lands it with one merge commit. That commit's FIRST parent is on the
 * base branch, its SECOND parent is the unchanged head of the OPEN release-state PR, and its changelog and package-log
 * edits are exactly the stamp's own. Such a PR is judged as the release PR it lands; anything else is not a landing.
 */
export type LandedReleasePr = {
  readonly number: number
  readonly state: string
  readonly headSha: string
  readonly headRepo: string
  readonly branch: string
  readonly title: string
  readonly body: string
}

export type LandingFacts = {
  /** The PR's own head commit: HEAD itself, or HEAD's second parent when CI checks out the merge ref. */
  readonly headSha: string
  readonly repo: string
  readonly baseHead: string
  readonly landedPr: LandedReleasePr | null
}

export type LandingGit = {
  readonly parents: (rev: string) => readonly string[]
  readonly isAncestor: (ancestor: string, descendant: string) => boolean
  readonly changelogDiff: (from: string, to: string) => string
}

export type LandingVerdict =
  | {
      readonly landing: true
      readonly firstParent: string
      readonly stamp: string
    }
  | { readonly landing: false; readonly reason: string }

export const CHANGELOG_PATHSPECS = ["CHANGELOG.md", "changes.md", "changes", ":(glob)packages/*/changes.md"] as const

const SHA = /^[0-9a-f]{40}$/

export function parseLandedPr(raw: string | undefined): LandedReleasePr | null {
  if (raw === undefined || raw.trim() === "") return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== "object" || value === null) return null
  const record: Record<string, unknown> = { ...value }
  const { number, state, headSha, headRepo, branch, title, body } = record
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) return null
  if (typeof state !== "string" || typeof headSha !== "string" || typeof headRepo !== "string") return null
  if (typeof branch !== "string" || typeof title !== "string" || typeof body !== "string") return null
  return { number, state, headSha, headRepo, branch, title, body }
}

export function judgeReleaseStateLanding(facts: LandingFacts, git: LandingGit): LandingVerdict {
  const pr = facts.landedPr
  if (pr === null) return { landing: false, reason: "no release-state PR facts were passed" }
  if (!SHA.test(facts.headSha) || !SHA.test(pr.headSha)) return { landing: false, reason: "a head sha is not 40 hex" }
  const parents = git.parents(facts.headSha)
  if (parents.length !== 2) return { landing: false, reason: "the PR head is not a two-parent merge" }
  const [firstParent, stamp] = parents
  if (firstParent === undefined || stamp === undefined) return { landing: false, reason: "the PR head has no parents" }
  if (stamp !== pr.headSha)
    return {
      landing: false,
      reason: `the second parent is not the head of #${pr.number}`,
    }
  if (pr.state !== "OPEN") return { landing: false, reason: `#${pr.number} is not open` }
  if (pr.headRepo !== facts.repo)
    return {
      landing: false,
      reason: `#${pr.number} is not from this repository`,
    }
  if (!isReleaseStatePr(pr))
    return {
      landing: false,
      reason: `#${pr.number} is not a release-state PR`,
    }
  if (!git.isAncestor(firstParent, facts.baseHead))
    return {
      landing: false,
      reason: "the first parent is not on the base branch",
    }
  const [stampParent] = git.parents(stamp)
  if (stampParent === undefined) return { landing: false, reason: "the stamp has no parent" }
  if (git.changelogDiff(firstParent, facts.headSha) !== git.changelogDiff(stampParent, stamp)) {
    return {
      landing: false,
      reason: "the merge changes the changelog or a package log beyond the stamp",
    }
  }
  return { landing: true, firstParent, stamp }
}
