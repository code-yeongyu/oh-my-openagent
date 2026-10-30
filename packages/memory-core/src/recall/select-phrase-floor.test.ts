import { describe, expect, it } from "bun:test"
import type { RecallDocument } from "./provider"
import { selectRecallCandidates } from "./select"

function doc(path: string, description: string, body: string): RecallDocument {
  return { path, description, body }
}

const HYBRID_OPTS = { maxItems: 5, surfaced: new Set<string>(), strategy: "hybrid" as const }
const paths = (candidates: readonly { path: string }[]): string[] => candidates.map((candidate) => candidate.path)

describe("selectRecallCandidates hybrid phrase floor", () => {
  // The phrase note says "status updates" once; the noise notes repeat the lone words, so bm25 ranks
  // them first and the flat substring vote cannot tell the phrase hit from a lone-word hit.
  const phrase = doc("people/dana.md", "Dana", "Dana wants weekly status updates on Friday with the release date first.")
  const noise = [
    doc("archive/a.md", "updates written", "updates written updates written"),
    doc("archive/b.md", "written updates", "written updates written"),
  ]
  const documents = [phrase, ...noise]
  const queries = ["updates", "written", '"status updates"']

  it("#given a phrase match bm25 ranks below lone-word matches #when hybrid selects #then the phrase match stays first", () => {
    // given
    const bm25 = selectRecallCandidates(documents, queries, { ...HYBRID_OPTS, strategy: "bm25" })

    // when
    const hybrid = selectRecallCandidates(documents, queries, HYBRID_OPTS)

    // then
    expect(paths(bm25)[0]).not.toBe("people/dana.md")
    expect(paths(hybrid)[0]).toBe("people/dana.md")
    expect(new Set(paths(hybrid))).toEqual(new Set(paths(documents)))
  })

  it("#given the pinned phrase match #when scores are read #then they stay ascending", () => {
    // when
    const hybrid = selectRecallCandidates(documents, queries, HYBRID_OPTS)

    // then
    const scores = hybrid.map((candidate) => candidate.score)
    expect(scores).toEqual([...scores].sort((left, right) => left - right))
  })

  it("#given the phrase match is surfaced #when hybrid selects #then the floor does not bring it back", () => {
    // given
    const options = { ...HYBRID_OPTS, surfaced: new Set(["people/dana.md"]) }

    // when
    const hybrid = selectRecallCandidates(documents, queries, options)

    // then
    expect(paths(hybrid)).not.toContain("people/dana.md")
    expect(paths(hybrid)).toHaveLength(2)
  })

  it("#given only lone-word queries #when hybrid selects #then fusion alone orders the notes", () => {
    // given
    const loneWords = ["updates", "written"]

    // when
    const hybrid = selectRecallCandidates(documents, loneWords, HYBRID_OPTS)

    // then
    expect(paths(hybrid)[0]).not.toBe("people/dana.md")
  })

  it("#given a Korean phrase match #when hybrid selects #then fusion orders the notes instead of the floor", () => {
    // given
    const korean = [
      doc("reference/ko/early.md", "배포 절차", "배포 절차 문서"),
      doc("reference/ko/rich.md", "절차", "배포할 때 절차를 지키고 배포하면 절차 확인"),
    ]
    const koreanQueries = ["배포할", "절차를", '"배포 절차"']
    const bm25 = selectRecallCandidates(korean, koreanQueries, { ...HYBRID_OPTS, strategy: "bm25" })

    // when
    const hybrid = selectRecallCandidates(korean, koreanQueries, HYBRID_OPTS)

    // then
    expect(paths(bm25)[0]).toBe("reference/ko/rich.md")
    expect(paths(hybrid)[0]).toBe("reference/ko/rich.md")
  })
})
