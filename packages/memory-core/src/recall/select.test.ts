import { describe, expect, it } from "bun:test"
import type { RecallDocument } from "./provider"
import { selectRecallCandidates, type RecallCandidate } from "./select"

function doc(path: string, description: string, body: string): RecallDocument {
  return { path, description, body }
}

function paths(candidates: readonly RecallCandidate[]): string[] {
  return candidates.map((candidate) => candidate.path)
}

const BASE_OPTS = {
  maxItems: 5,
  excerptChars: 200,
  surfaced: new Set<string>(),
}

describe("selectRecallCandidates", () => {
  it("#given no queries #when candidates are selected #then nothing is returned", () => {
    // given
    const documents = [doc("reference/a.md", "Deploy", "the kubernetes ingress gateway is flaky")]

    // when
    const candidates = selectRecallCandidates(documents, [], BASE_OPTS)

    // then
    expect(candidates).toEqual([])
  })

  it("#given matching documents #when candidates are selected #then scores are ascending", () => {
    // given
    const documents = [
      doc("reference/a.md", "Deploy", "the kubernetes ingress gateway is flaky"),
      doc("notes/b.md", "Kubernetes notes", "kubernetes kubernetes everywhere"),
    ]

    // when
    const candidates = selectRecallCandidates(documents, ["kubernetes"], BASE_OPTS)

    // then (b matches at index 0 of the haystack; a matches at index 11)
    expect(paths(candidates)).toEqual(["notes/b.md", "reference/a.md"])
    expect(candidates[0]?.score).toBe(40)
    expect(candidates[1]?.score).toBe(51)
  })

  it("#given multiple queries #when candidates are selected #then each path keeps its best score", () => {
    // given
    const documents = [
      doc("reference/c.md", "Ingress", "ingress gateway review"),
      doc("reference/d.md", "kubernetes ingress", "see the ingress gateway and kubernetes"),
    ]

    // when
    const candidates = selectRecallCandidates(documents, ["kubernetes", '"ingress gateway"'], BASE_OPTS)

    // then (c matches only the phrase; d matches both and keeps the lower phrase score)
    expect(paths(candidates)).toEqual(["reference/c.md", "reference/d.md"])
    expect(candidates[0]?.score ?? 0).toBeCloseTo(0.8, 5)
    expect(candidates[1]?.score ?? 0).toBeCloseTo(2.7, 5)
  })

  it("#given surfaced paths #when candidates are selected #then already surfaced paths drop", () => {
    // given
    const documents = [
      doc("reference/c.md", "Ingress", "ingress gateway review"),
      doc("reference/d.md", "kubernetes ingress", "see the ingress gateway and kubernetes"),
    ]
    const opts = { ...BASE_OPTS, surfaced: new Set(["reference/c.md"]) }

    // when
    const candidates = selectRecallCandidates(documents, ["ingress"], opts)

    // then
    expect(paths(candidates)).toEqual(["reference/d.md"])
  })

  it("#given exclude patterns #when candidates are selected #then prefix globs and exact paths drop", () => {
    // given
    const documents = [
      doc("notes/deploy.md", "Deploy notes", "ingress and kubernetes"),
      doc("notes/other.md", "Other notes", "ingress and kubernetes"),
      doc("people/alice.md", "Alice", "ingress and kubernetes"),
      doc("reference/keep.md", "Keep", "ingress and kubernetes"),
    ]
    const opts = { ...BASE_OPTS, exclude: ["notes/deploy*", "people/alice.md"] }

    // when
    const candidates = selectRecallCandidates(documents, ["kubernetes"], opts)

    // then ("keep" has the shortest description, so its term index is smallest)
    expect(paths(candidates)).toEqual(["reference/keep.md", "notes/other.md"])
  })

  it("#given a minScore ceiling #when candidates are selected #then scores above the ceiling drop", () => {
    // given (lower score is better, so minScore is a ceiling: score <= minScore keeps)
    const documents = [
      doc("reference/a.md", "Deploy", "the kubernetes ingress gateway is flaky"),
      doc("notes/b.md", "Kubernetes notes", "kubernetes kubernetes everywhere"),
    ]
    const opts = { ...BASE_OPTS, minScore: 45 }

    // when
    const candidates = selectRecallCandidates(documents, ["kubernetes"], opts)

    // then (a scores 51 and drops; b scores 40 and stays)
    expect(paths(candidates)).toEqual(["notes/b.md"])
  })

  it("#given more matches than maxItems #when candidates are selected #then only the best capped set returns", () => {
    // given
    const documents = [
      doc("reference/a.md", "Deploy", "the kubernetes ingress gateway is flaky"),
      doc("notes/b.md", "Kubernetes notes", "kubernetes kubernetes everywhere"),
      doc("skills/c.md", "kubernetes skill", "kubernetes everywhere"),
    ]

    // when
    const candidates = selectRecallCandidates(documents, ["kubernetes"], { ...BASE_OPTS, maxItems: 2 })

    // then
    expect(paths(candidates)).toEqual(["notes/b.md", "skills/c.md"])
  })

  it("#given equal scores #when candidates are selected #then the path breaks the tie", () => {
    // given
    const documents = [
      doc("reference/z.md", "Same", "kubernetes everywhere"),
      doc("reference/a.md", "Same", "kubernetes everywhere"),
    ]

    // when
    const candidates = selectRecallCandidates(documents, ["kubernetes"], BASE_OPTS)

    // then
    expect(paths(candidates)).toEqual(["reference/a.md", "reference/z.md"])
  })

  it("#given a term match inside the body #when the excerpt is built #then it is a centered whitespace-normalized window", () => {
    // given
    const body =
      "Start of the note. The kubernetes rollout paused because of the cert rotation. End of the note."
    const documents = [doc("reference/a.md", "Deploy", body)]

    // when
    const candidates = selectRecallCandidates(documents, ["kubernetes"], {
      ...BASE_OPTS,
      excerptChars: 40,
    })

    // then
    const excerpt = candidates[0]?.excerpt ?? ""
    expect(excerpt).toContain("kubernetes")
    expect(excerpt.length).toBeLessThanOrEqual(40)
    expect(excerpt).not.toMatch(/\s{2,}|\n/)
  })

  it("#given a match only in the description #when the excerpt is built #then the body head is used", () => {
    // given
    const documents = [doc("reference/a.md", "kubernetes deep dive", "Nothing relevant lives here")]

    // when
    const candidates = selectRecallCandidates(documents, ["kubernetes"], BASE_OPTS)

    // then
    expect(candidates[0]?.excerpt).toBe("Nothing relevant lives here")
  })

  it("#given a multi-line body #when the excerpt is built #then newlines collapse to single spaces", () => {
    // given
    const documents = [
      doc("reference/a.md", "Deploy", "first line\n\nsecond line mentions kubernetes\nthird line"),
    ]

    // when
    const candidates = selectRecallCandidates(documents, ["kubernetes"], BASE_OPTS)

    // then
    expect(candidates[0]?.excerpt).not.toContain("\n")
    expect(candidates[0]?.excerpt).toContain("mentions kubernetes")
  })

  it("#given a non-positive maxItems #when candidates are selected #then nothing is returned", () => {
    // given
    const documents = [doc("notes/b.md", "Kubernetes notes", "kubernetes everywhere")]

    // when
    const candidates = selectRecallCandidates(documents, ["kubernetes"], { ...BASE_OPTS, maxItems: 0 })

    // then
    expect(candidates).toEqual([])
  })
})
