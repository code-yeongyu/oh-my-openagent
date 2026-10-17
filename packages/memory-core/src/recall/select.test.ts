import { describe, expect, it } from "bun:test"
import { matchScore, matchScoreNormalized, normalizeText, parseQuery } from "../search"
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

  it("#given transcript-visible paths #when candidates are selected #then excluded paths do not consume the cap", () => {
    // given
    const documents = [
      doc("reference/a.md", "Kubernetes", "ingress review"),
      doc("reference/b.md", "Kubernetes", "rollout review"),
    ]
    const excludePaths: ReadonlySet<string> = new Set(["reference/a.md"])
    const options = { ...BASE_OPTS, maxItems: 1, excludePaths }

    // when
    const candidates = selectRecallCandidates(documents, ["kubernetes"], options)

    // then
    expect(paths(candidates)).toEqual(["reference/b.md"])
    expect(excludePaths).toEqual(new Set(["reference/a.md"]))
  })

  it("#given surfaced and transcript-visible paths #when candidates are selected #then both exclusions apply", () => {
    // given
    const documents = ["a", "b", "c"].map((name) => doc(`reference/${name}.md`, "Kubernetes", "review"))
    const options = {
      ...BASE_OPTS,
      surfaced: new Set(["reference/a.md"]),
      excludePaths: new Set(["reference/b.md"]),
    }

    // when
    const candidates = selectRecallCandidates(documents, ["kubernetes"], options)

    // then
    expect(paths(candidates)).toEqual(["reference/c.md"])
  })

  it("#given an empty exclusion set #when candidates are selected #then omitted and empty options are equivalent", () => {
    // given
    const documents = [doc("reference/a.md", "Kubernetes", "ingress review")]
    const options = { ...BASE_OPTS, excludePaths: new Set<string>() }

    // when
    const candidates = selectRecallCandidates(documents, ["kubernetes"], options)

    // then
    expect(candidates).toEqual(selectRecallCandidates(documents, ["kubernetes"], BASE_OPTS))
    expect(paths(candidates)).toEqual(["reference/a.md"])
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
    const candidates = selectRecallCandidates(documents, ["kubernetes"], BASE_OPTS)

    // then
    const excerpt = candidates[0]?.excerpt ?? ""
    expect(excerpt).toContain("kubernetes")
    expect(excerpt).not.toMatch(/\s{2,}|\n/)
  })

  it("#given a body longer than the internal excerpt length #when the excerpt is built #then it is capped at 200 characters", () => {
    // given: excerpt length is an internal constant, not a config knob
    const body = `${"filler word ".repeat(40)}kubernetes rollout ${"trailing word ".repeat(40)}`
    const documents = [doc("reference/a.md", "Deploy", body)]

    // when
    const candidates = selectRecallCandidates(documents, ["kubernetes"], BASE_OPTS)

    // then
    const excerpt = candidates[0]?.excerpt ?? ""
    expect(excerpt).toContain("kubernetes")
    expect(excerpt.length).toBeLessThanOrEqual(200)
    expect(excerpt.length).toBeGreaterThan(150)
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

  it("#given the same document objects #when selection repeats #then the normalized haystack is composed once", () => {
    // given: a document that matches nothing, so only the haystack ever reads the body
    let bodyReads = 0
    const document: RecallDocument = {
      path: "reference/a.md",
      description: "Deploy",
      get body(): string {
        bodyReads += 1
        return "nothing relevant lives here"
      },
    }

    // when
    for (let call = 0; call < 3; call += 1) {
      expect(selectRecallCandidates([document], ["kubernetes", "ingress"], BASE_OPTS)).toEqual([])
    }

    // then
    expect(bodyReads).toBe(1)
  })

  it("#given a memoized haystack #when selection repeats #then candidates stay deep-equal to the unmemoized scorer", () => {
    // given
    const documents = [
      doc("reference/a.md", "Deploy", "The KUBERNETES ingress   gateway\nis flaky during rollouts"),
      doc("notes/b.md", "Kubernetes notes", "kubernetes kubernetes everywhere and the ingress gateway too"),
      doc("skills/c.md", "Rollout skill", "nothing relevant lives here"),
    ]
    const queries = ["kubernetes", '"ingress gateway"', "rollouts kubernetes"]
    const expected = documents
      .map((document) => {
        const scores = queries
          .map((query) => matchScore(`${document.description}\n${document.body}`, parseQuery(query)))
          .filter((score): score is number => score !== null)
        return scores.length === 0 ? undefined : { path: document.path, score: Math.min(...scores) }
      })
      .filter((entry): entry is { path: string; score: number } => entry !== undefined)
      .sort((left, right) => left.score - right.score || left.path.localeCompare(right.path))

    // when
    const first = selectRecallCandidates(documents, queries, BASE_OPTS)
    const second = selectRecallCandidates(documents, queries, BASE_OPTS)

    // then
    expect(second).toEqual(first)
    expect(first.map((candidate) => ({ path: candidate.path, score: candidate.score }))).toEqual(expected)
  })

  it("#given a pre-normalized haystack #when the normalized scorer runs #then it equals the raw-input scorer", () => {
    // given
    const samples = [
      "Deploy\nThe KUBERNETES ingress   gateway\nis flaky",
      "   ",
      "",
      "kubernetes\n\ningress gateway",
    ]
    const queries = ["kubernetes", '"ingress gateway"', "kubernetes missing", '"unclosed', "  "]

    // when / then
    for (const sample of samples) {
      for (const query of queries) {
        const parsed = parseQuery(query)
        expect(matchScoreNormalized(normalizeText(sample), parsed)).toBe(matchScore(sample, parsed))
      }
    }
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

describe("selectRecallCandidates automatic strategy", () => {
  it("#given English queries over a small English corpus #when the strategy is omitted #then results equal the explicit substring strategy", () => {
    // given
    const documents = [
      doc("reference/a.md", "Deploy", "the kubernetes ingress gateway is flaky"),
      doc("notes/b.md", "Kubernetes notes", "kubernetes kubernetes everywhere"),
    ]

    // when
    const omitted = selectRecallCandidates(documents, ["kubernetes"], BASE_OPTS)
    const explicit = selectRecallCandidates(documents, ["kubernetes"], { ...BASE_OPTS, strategy: "substring" })

    // then
    expect(omitted).toEqual(explicit)
  })

  it("#given an inflected Korean planner term #when the strategy is omitted #then the stem note surfaces where substring finds nothing", () => {
    // given
    const documents = [
      doc("reference/publish.md", "npm 퍼블리시 절차", "배포 토큰은 키체인에 저장한다"),
      doc("reference/travel.md", "여행 계획", "다음 달 제주도"),
    ]
    const queries = ["퍼블리시할", "보관할"]

    // when
    const substring = selectRecallCandidates(documents, queries, { ...BASE_OPTS, strategy: "substring" })
    const automatic = selectRecallCandidates(documents, queries, BASE_OPTS)

    // then
    expect(paths(substring)).toEqual([])
    expect(paths(automatic)).toEqual(["reference/publish.md"])
  })

  it("#given a Chinese planner term sharing only single characters with a note #when the strategy is omitted #then the note surfaces", () => {
    // given
    const documents = [
      doc("reference/zh/expenses.md", "报销规定", "差旅报销上限为每天五百元"),
      doc("reference/zh/meeting.md", "周会安排", "每周一上午开周会"),
    ]

    // when
    const candidates = selectRecallCandidates(documents, ["出差能报多少钱"], BASE_OPTS)

    // then
    expect(paths(candidates)).toEqual(["reference/zh/expenses.md"])
  })

  it("#given a long note matched only through single Han characters #when the strategy is omitted #then the excerpt centers on the match", () => {
    // given: the matching sentence sits far past the excerpt length
    const documents = [
      doc("reference/zh/expenses.md", "费用说明", `${"intro ".repeat(60)}差旅报销上限为每天五百元`),
      doc("reference/zh/meeting.md", "周会安排", "每周一上午开周会"),
    ]

    // when
    const candidates = selectRecallCandidates(documents, ["出差能报多少钱"], BASE_OPTS)

    // then
    expect(paths(candidates)).toEqual(["reference/zh/expenses.md"])
    expect(candidates[0]?.excerpt).toContain("差旅报销上限")
  })

  it("#given a note holding a longer query token and an earlier single Han character #when the strategy is omitted #then the longer token anchors the excerpt", () => {
    // given: 报 occurs at the very start, the two-character piece 出差 only at the end
    const documents = [
      doc("reference/zh/travel.md", "差旅", `报${" filler".repeat(60)} 出差申请提前三天`),
      doc("reference/zh/meeting.md", "周会安排", "每周一上午开周会"),
    ]

    // when
    const candidates = selectRecallCandidates(documents, ["出差能报多少钱"], BASE_OPTS)

    // then
    expect(candidates[0]?.excerpt).toContain("出差申请")
  })

  it("#given an NFD-stored Hangul note #when a composed Korean query selects #then the note surfaces", () => {
    // given: text pasted from macOS file names is often NFD
    const documents = [
      doc("reference/publish.md", "npm 퍼블리시 절차".normalize("NFD"), "토큰은 키체인에 있다".normalize("NFD")),
      doc("reference/travel.md", "여행 계획", "다음 달 제주도"),
    ]

    // when
    const candidates = selectRecallCandidates(documents, ["퍼블리시할"], BASE_OPTS)

    // then
    expect(paths(candidates)).toEqual(["reference/publish.md"])
  })

  it("#given a full-width Latin query #when it selects over a half-width note #then the note surfaces", () => {
    // given
    const documents = [
      doc("reference/npm.md", "npm token", "the npm token lives in the keychain"),
      doc("reference/travel.md", "여행 계획", "다음 달 제주도"),
    ]

    // when
    const candidates = selectRecallCandidates(documents, ["ＮＰＭ", "토큰"], BASE_OPTS)

    // then
    expect(paths(candidates)).toEqual(["reference/npm.md"])
  })
})

describe("selectRecallCandidates with the hybrid strategy", () => {
  const HYBRID_OPTS = { ...BASE_OPTS, strategy: "hybrid" as const }
  const documents = [
    doc("a/deploy.md", "Redeploy", "redeploy runbook"),
    doc("b/tmux.md", "tmux", "tmux targeting"),
    doc("c/notes.md", "notes", "a long note that mentions tmux once among many other words"),
  ]
  const queries = ["deploy", "tmux", "targeting"]

  it("#given a Chinese planner term sharing only single characters with a note #when hybrid selects #then the note surfaces", () => {
    // given: substring matching and the two-character pieces both miss
    const chinese = [
      doc("reference/zh/expenses.md", "报销规定", "差旅报销上限为每天五百元"),
      doc("reference/zh/meeting.md", "周会安排", "每周一上午开周会"),
    ]

    // when
    const substring = selectRecallCandidates(chinese, ["出差能报多少钱"], { ...BASE_OPTS, strategy: "substring" })
    const hybrid = selectRecallCandidates(chinese, ["出差能报多少钱"], HYBRID_OPTS)

    // then
    expect(paths(substring)).toEqual([])
    expect(paths(hybrid)).toEqual(["reference/zh/expenses.md"])
  })

  it("#given a long note matched only through single Han characters #when hybrid selects #then the excerpt centers on the match", () => {
    // given
    const chinese = [
      doc("reference/zh/expenses.md", "费用说明", `${"intro ".repeat(60)}差旅报销上限为每天五百元`),
      doc("reference/zh/meeting.md", "周会安排", "每周一上午开周会"),
    ]

    // when
    const hybrid = selectRecallCandidates(chinese, ["出差能报多少钱"], HYBRID_OPTS)

    // then
    expect(hybrid[0]?.excerpt).toContain("差旅报销上限")
  })

  it("#given documents only one ranker finds #when hybrid selects #then it returns the union of both rankers", () => {
    // given
    const substring = selectRecallCandidates(documents, queries, { ...BASE_OPTS, strategy: "substring" })
    const bm25 = selectRecallCandidates(documents, queries, { ...BASE_OPTS, strategy: "bm25" })

    // when
    const hybrid = selectRecallCandidates(documents, queries, HYBRID_OPTS)

    // then
    expect(paths(substring)).toContain("a/deploy.md")
    expect(paths(bm25)).not.toContain("a/deploy.md")
    expect(new Set(paths(hybrid))).toEqual(new Set([...paths(substring), ...paths(bm25)]))
  })

  it("#given a document both rankers find #when hybrid selects #then it outranks documents only one ranker finds", () => {
    // given
    const options = { ...HYBRID_OPTS, maxItems: 1 }

    // when
    const hybrid = selectRecallCandidates(documents, queries, options)

    // then
    expect(paths(hybrid)).toEqual(["b/tmux.md"])
  })

  it("#given two substring matches in opposite bm25 order #when hybrid selects #then the substring offset does not decide the order", () => {
    // given
    const offsetFirst = doc("a/offset.md", "tmux", `${"unrelated filler words ".repeat(20)}end`)
    const relevant = doc("z/relevant.md", "notes", "tmux tmux tmux")
    const pair = [offsetFirst, relevant]
    const bySubstring = selectRecallCandidates(pair, ["tmux"], { ...BASE_OPTS, strategy: "substring" })
    const byBm25 = selectRecallCandidates(pair, ["tmux"], { ...BASE_OPTS, strategy: "bm25" })

    // when
    const hybrid = selectRecallCandidates(pair, ["tmux"], HYBRID_OPTS)

    // then
    expect(paths(bySubstring)).toEqual(["a/offset.md", "z/relevant.md"])
    expect(paths(byBm25)).toEqual(["z/relevant.md", "a/offset.md"])
    expect(paths(hybrid)).toEqual(["z/relevant.md", "a/offset.md"])
  })

  it("#given a bm25-only match tied with a substring-only match #when hybrid selects #then the bm25 rank breaks the tie before the path", () => {
    // given: the inflected Korean term only bm25 finds, the English in-word match only substring finds
    const pair = [
      doc("a/tokens.md", "subtokens", "subtokens rotated weekly"),
      doc("z/publish.md", "npm 퍼블리시 절차", "절차 문서"),
    ]
    const queries = ["퍼블리시할", "token"]

    // when
    const hybrid = selectRecallCandidates(pair, queries, HYBRID_OPTS)

    // then
    expect(paths(selectRecallCandidates(pair, queries, { ...BASE_OPTS, strategy: "substring" }))).toEqual(["a/tokens.md"])
    expect(paths(selectRecallCandidates(pair, queries, { ...BASE_OPTS, strategy: "bm25" }))).toEqual(["z/publish.md"])
    expect(paths(hybrid)).toEqual(["z/publish.md", "a/tokens.md"])
    expect(hybrid[0]?.score).toBe(hybrid[1]?.score ?? Number.NaN)
  })

  it("#given hybrid candidates #when scores are read #then they stay ascending and lower-is-better in (0, 1]", () => {
    // when
    const hybrid = selectRecallCandidates(documents, queries, HYBRID_OPTS)

    // then
    const scores = hybrid.map((candidate) => candidate.score)
    expect(scores).toEqual([...scores].sort((left, right) => left - right))
    for (const score of scores) {
      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThanOrEqual(1)
    }
  })

  it("#given surfaced and excluded paths #when hybrid selects #then exclusions apply before the cap", () => {
    // given
    const options = {
      ...HYBRID_OPTS,
      maxItems: 3,
      surfaced: new Set(["b/tmux.md"]),
      excludePaths: new Set(["a/deploy.md"]),
    }

    // when
    const hybrid = selectRecallCandidates(documents, queries, options)

    // then
    expect(paths(hybrid)).toEqual(["c/notes.md"])
  })
})

describe("selectRecallCandidates with the bm25 strategy", () => {
  const BM25_OPTS = { ...BASE_OPTS, strategy: "bm25" as const }

  it("#given a distinctive term and a common term #when bm25 selects #then the distinctive match ranks first", () => {
    // given: substring ranking prefers the earliest occurrence of any single term
    const documents = [
      doc("notes/journal.md", "Session journal", "session notes and more session notes"),
      doc("reference/tmux.md", "Targeting rules", "kill a session with tmux using an exact target"),
    ]

    // when
    const candidates = selectRecallCandidates(documents, ["session", "tmux"], BM25_OPTS)

    // then
    expect(paths(candidates)[0]).toBe("reference/tmux.md")
  })

  it("#given bm25 candidates #when scores are read #then they stay ascending and lower-is-better in (0, 1]", () => {
    // given
    const documents = [
      doc("reference/tmux.md", "tmux", "tmux exact targeting"),
      doc("notes/other.md", "notes", "tmux mentioned once among many other unrelated words here"),
    ]

    // when
    const candidates = selectRecallCandidates(documents, ["tmux", "targeting"], BM25_OPTS)

    // then
    const scores = candidates.map((candidate) => candidate.score)
    expect(scores).toEqual([...scores].sort((left, right) => left - right))
    for (const score of scores) {
      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThanOrEqual(1)
    }
  })

  it("#given surfaced, excluded paths and a cap #when bm25 selects #then exclusions apply before the cap", () => {
    // given
    const documents = ["a", "b", "c", "d"].map((name) => doc(`reference/${name}.md`, "tmux", "tmux rules"))
    const options = {
      ...BM25_OPTS,
      maxItems: 1,
      surfaced: new Set(["reference/a.md"]),
      excludePaths: new Set(["reference/b.md"]),
    }

    // when
    const candidates = selectRecallCandidates(documents, ["tmux"], options)

    // then
    expect(paths(candidates)).toEqual(["reference/c.md"])
  })

  it("#given a Korean match inside a longer word #when bm25 builds the excerpt #then it is centered on the matched text", () => {
    // given
    const body = `${"앞부분 설명 ".repeat(30)}퍼블리시 토큰 위치는 키체인이다 ${"뒷부분 설명 ".repeat(30)}`
    const documents = [doc("reference/publish.md", "절차", body)]

    // when
    const candidates = selectRecallCandidates(documents, ["퍼블리시할"], BM25_OPTS)

    // then
    const excerpt = candidates[0]?.excerpt ?? ""
    expect(excerpt).toContain("퍼블리시 토큰")
    expect(excerpt.length).toBeLessThanOrEqual(200)
  })
})

describe("selectRecallCandidates with expansions", () => {
  const lead = Array.from({ length: 60 }, (_, index) => `padding${index}`).join(" ")
  const small = [
    doc("notes/revert.md", "Release", `${lead} revert the release when the canary fails`),
    doc("notes/deploy.md", "Deploy", "deploy rollback steps for the lighthouse service"),
    doc("notes/lunch.md", "Lunch", "order noodles on friday"),
  ]

  it("#given a small English memory and a question worded differently #when the caller adds synonyms #then the note is found and the excerpt shows the matched passage", () => {
    // when
    const plain = selectRecallCandidates(small, ["undo shipment"], BASE_OPTS)
    const widened = selectRecallCandidates(small, ["undo shipment"], { ...BASE_OPTS, expansions: { synonyms: ["revert", "release"] } })

    // then
    expect(plain).toEqual([])
    expect(paths(widened)).toEqual(["notes/revert.md"])
    expect(widened[0]?.excerpt).toContain("revert the release")
  })

  it("#given a note matching every query word #when the search is widened #then it stays ahead of the notes only an added term found", () => {
    // when
    const widened = selectRecallCandidates(small, ["deploy rollback"], {
      ...BASE_OPTS,
      expansions: { synonyms: ["revert", "release", "canary"], related: ["noodles"] },
    })

    // then
    expect(paths(widened)).toEqual(["notes/deploy.md", "notes/revert.md", "notes/lunch.md"])
    const scores = widened.map((candidate) => candidate.score)
    expect(scores).toEqual([...scores].sort((left, right) => left - right))
  })

  it("#given no expansions, empty ones or blank ones #when candidates are selected #then the list equals the one without the option", () => {
    // given
    const korean = [...small, doc("notes/ko.md", "배포", "퍼블리시 절차와 배포 체크리스트")]

    // when / then
    for (const [documents, query] of [[small, "deploy rollback"], [small, "release"], [korean, "퍼블리시할 배포"]] as const) {
      const plain = selectRecallCandidates(documents, [query], BASE_OPTS)
      expect(selectRecallCandidates(documents, [query], { ...BASE_OPTS, expansions: {} })).toEqual(plain)
      expect(selectRecallCandidates(documents, [query], { ...BASE_OPTS, expansions: { synonyms: [], related: ["  "], noteLine: "" } })).toEqual(plain)
    }
  })

  it("#given a large memory #when the search is widened #then the hybrid keeps the full match first and adds the note an added term found", () => {
    // given
    const fillers = Array.from({ length: 220 }, (_, index) => doc(`archive/filler-${String(index).padStart(3, "0")}.md`, "Filler", `unrelated words number ${index}`))
    const documents = [...small, ...fillers]

    // when
    const plain = selectRecallCandidates(documents, ["deploy rollback"], BASE_OPTS)
    const widened = selectRecallCandidates(documents, ["deploy rollback"], { ...BASE_OPTS, expansions: { synonyms: ["revert", "canary"] } })

    // then
    expect(paths(plain)).toEqual(["notes/deploy.md"])
    expect(paths(widened)).toEqual(["notes/deploy.md", "notes/revert.md"])
  })

  it("#given a small English memory with several verbatim matches #when the search is widened #then today's results come first in today's order", () => {
    // given (the substring scorer orders by the offset of the match, bm25 would order b before a)
    const documents = [
      doc("notes/a.md", "One", `deploy ${"padding ".repeat(100)}`),
      doc("notes/b.md", "One", "x deploy"),
      doc("notes/c.md", "One", "rollout"),
    ]

    // when
    const plain = selectRecallCandidates(documents, ["deploy"], BASE_OPTS)
    const widened = selectRecallCandidates(documents, ["deploy"], { ...BASE_OPTS, expansions: { synonyms: ["rollout"] } })

    // then
    expect(paths(plain)).toEqual(["notes/a.md", "notes/b.md"])
    expect(paths(widened)).toEqual(["notes/a.md", "notes/b.md", "notes/c.md"])
    expect(widened.slice(0, 2).map((candidate) => candidate.excerpt)).toEqual(plain.map((candidate) => candidate.excerpt))
  })

  it("#given a large memory where an added term also matches a verbatim partial match #when one candidate is asked for #then the note holding the whole query word keeps first place", () => {
    // given ("run" is the whole query word after the English fold; "outrunning" only contains it)
    const fillers = Array.from({ length: 200 }, (_, index) => doc(`archive/filler-${String(index).padStart(3, "0")}.md`, "", "alpha beta gamma"))
    const documents = [doc("full.md", "", "run"), doc("partial.md", "", "outrunning rollout"), ...fillers]
    const one = { maxItems: 1, surfaced: new Set<string>() }

    // when
    const plain = selectRecallCandidates(documents, ["running"], one)
    const widened = selectRecallCandidates(documents, ["running"], { ...one, expansions: { synonyms: ["rollout"] } })

    // then
    expect(paths(plain)).toEqual(["full.md"])
    expect(paths(widened)).toEqual(["full.md"])
  })

  it("#given expansions that only repeat the query or hold no word #when candidates are selected #then the list equals the search as written", () => {
    // given (a verbatim partial match next to the note holding the whole query word, as above)
    const fillers = Array.from({ length: 200 }, (_, index) => doc(`archive/filler-${String(index).padStart(3, "0")}.md`, "", "alpha beta gamma"))
    const documents = [doc("full.md", "", "run"), doc("partial.md", "", "outrunning rollout"), ...fillers]

    // when / then
    const plain = selectRecallCandidates(documents, ["running"], BASE_OPTS)
    expect(paths(plain)).toEqual(["full.md", "partial.md"])
    for (const expansions of [{ synonyms: ["running"] }, { synonyms: ["!!!"] }, { related: ["Running", "runs"], noteLine: "..." }]) {
      expect(selectRecallCandidates(documents, ["running"], { ...BASE_OPTS, expansions })).toEqual(plain)
    }
  })

  it("#given a note found only through an added Han character #when selected #then the excerpt shows that character", () => {
    // given
    const documents = [doc("notes/key.md", "One", `${"padding ".repeat(60)}鍵`), doc("notes/lost.md", "One", "lost and found box")]

    // when
    const widened = selectRecallCandidates(documents, ["lost"], { ...BASE_OPTS, strategy: "bm25", expansions: { keywords: ["鍵"] } })

    // then
    expect(paths(widened)).toEqual(["notes/lost.md", "notes/key.md"])
    expect(widened[1]?.excerpt).toContain("鍵")
  })

  it("#given a widened search on any strategy #when candidates are returned #then the scores ascend", () => {
    for (const strategy of ["substring", "bm25", "hybrid"] as const) {
      const widened = selectRecallCandidates(small, ["deploy rollback"], { ...BASE_OPTS, strategy, expansions: { synonyms: ["revert", "canary"], related: ["noodles"] } })
      expect(paths(widened)).toEqual(["notes/deploy.md", "notes/revert.md", "notes/lunch.md"])
      const scores = widened.map((candidate) => candidate.score)
      expect(scores).toEqual([...scores].sort((left, right) => left - right))
      expect(new Set(scores).size).toBe(scores.length)
    }
  })
})
