import { readFileSync } from "node:fs"

import { CANDIDATES_LINE } from "./gate"

// Design 7.4 (amendment 3) with review 6061267823 H4: the candidate tier is a merge requirement carried by two people.
// Given the check's output at the pull request's own head, the pull request body and a review verdict, the verdict is
// accepted only when the body carries the author's `SDK-Parity-Unchanged: yes`, the verdict is a CLEAR given at that
// exact head, and it carries `SDK-Parity-Reviewed: <digest>` with the digest the check printed there. With no candidates
// there is nothing to review.
// Usage: bun script/sdk-parity/verify-review.ts --check <check output> --body <pull request body> --verdict <verdict text>

export type ReviewDecision = { readonly decision: "accepted" | "withheld"; readonly reason: string }

const REVIEWED_LINE = /^SDK-Parity-Reviewed:\s*([0-9a-f]+)\s*$/gm
const UNCHANGED_LINE = /^SDK-Parity-Unchanged:\s*yes\s*$/im
const CLEAR_VERDICT = /^(?:Verdict:\s*)?CLEAR\b/im
const FULL_HEAD = /\b[0-9a-f]{40}\b/g

const withheld = (reason: string): ReviewDecision => ({ decision: "withheld", reason })

export function verifyReview(checkOutput: string, body: string, verdict: string): ReviewDecision {
  const printed = CANDIDATES_LINE.exec(checkOutput)
  if (printed === null) return withheld("the check output carries no SDK-Parity-Candidates line")
  const [, head = "", digest = "", count = "0"] = printed
  if (Number(count) === 0)
    return { decision: "accepted", reason: `no candidate at ${head.slice(0, 10)}; nothing to review` }
  if (!UNCHANGED_LINE.test(body)) return withheld("the pull request body lacks the author's SDK-Parity-Unchanged: yes")
  if (!CLEAR_VERDICT.test(verdict)) return withheld("the verdict is not a CLEAR")
  const reviewed = [...verdict.matchAll(REVIEWED_LINE)].map((match) => match[1])
  if (reviewed.length === 0)
    return withheld(`the verdict lacks SDK-Parity-Reviewed; the check printed ${count} candidate(s), digest ${digest}`)
  const heads = new Set(verdict.match(FULL_HEAD) ?? [])
  if (!heads.has(head))
    return withheld(
      `the verdict was not given at ${head}${heads.size > 0 ? ` (it names ${[...heads].join(", ")})` : ""}`,
    )
  if (!reviewed.includes(digest))
    return withheld(
      `the verdict carries ${reviewed.join(", ")}, a digest the check did not print at ${head.slice(0, 10)} (${digest})`,
    )
  return {
    decision: "accepted",
    reason: `the CLEAR at ${head.slice(0, 10)} reviewed the ${count} candidate(s) of digest ${digest}`,
  }
}

if (import.meta.main) {
  const at = (flag: string): string => {
    const index = process.argv.indexOf(flag)
    const value = index < 0 ? undefined : process.argv[index + 1]
    if (value === undefined)
      throw new Error(`usage: verify-review.ts --check <file> --body <file> --verdict <file> (missing ${flag})`)
    return value
  }
  const result = verifyReview(
    readFileSync(at("--check"), "utf8"),
    readFileSync(at("--body"), "utf8"),
    readFileSync(at("--verdict"), "utf8"),
  )
  process.stdout.write(`${result.decision}: ${result.reason}\n`)
  process.exitCode = result.decision === "accepted" ? 0 : 1
}
