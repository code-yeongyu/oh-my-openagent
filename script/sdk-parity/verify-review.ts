import { readFileSync } from "node:fs"

import { CANDIDATES_LINE } from "./gate"

// Design 7.4 (amendment 3): the candidate tier is a merge requirement a reviewer carries. Given the check's output at a
// head and a review verdict's text, the verdict is accepted only when it was given at that exact head and carries
// `SDK-Parity-Reviewed: <digest>` with the digest the check printed there. With no candidates there is nothing to review.
// Usage: bun script/sdk-parity/verify-review.ts --check <check output file> --verdict <verdict text file>

export type ReviewDecision = { readonly decision: "accepted" | "withheld"; readonly reason: string }

const REVIEWED_LINE = /^SDK-Parity-Reviewed:\s*([0-9a-f]+)\s*$/gm
const FULL_HEAD = /\b[0-9a-f]{40}\b/g

export function verifyReview(checkOutput: string, verdict: string): ReviewDecision {
  const printed = CANDIDATES_LINE.exec(checkOutput)
  if (printed === null)
    return { decision: "withheld", reason: "the check output carries no SDK-Parity-Candidates line" }
  const [, head = "", digest = "", count = "0"] = printed
  if (Number(count) === 0)
    return { decision: "accepted", reason: `no candidate at ${head.slice(0, 10)}; nothing to review` }
  const reviewed = [...verdict.matchAll(REVIEWED_LINE)].map((match) => match[1])
  if (reviewed.length === 0)
    return {
      decision: "withheld",
      reason: `the verdict lacks SDK-Parity-Reviewed; the check printed ${count} candidate(s), digest ${digest}`,
    }
  const heads = new Set(verdict.match(FULL_HEAD) ?? [])
  if (!heads.has(head))
    return {
      decision: "withheld",
      reason: `the verdict was not given at ${head}${heads.size > 0 ? ` (it names ${[...heads].join(", ")})` : ""}`,
    }
  if (!reviewed.includes(digest))
    return {
      decision: "withheld",
      reason: `the verdict carries ${reviewed.join(", ")}, a digest the check did not print at ${head.slice(0, 10)} (${digest})`,
    }
  return {
    decision: "accepted",
    reason: `the verdict at ${head.slice(0, 10)} reviewed the ${count} candidate(s) of digest ${digest}`,
  }
}

if (import.meta.main) {
  const at = (flag: string): string => {
    const index = process.argv.indexOf(flag)
    const value = index < 0 ? undefined : process.argv[index + 1]
    if (value === undefined)
      throw new Error(`usage: verify-review.ts --check <file> --verdict <file> (missing ${flag})`)
    return value
  }
  const result = verifyReview(readFileSync(at("--check"), "utf8"), readFileSync(at("--verdict"), "utf8"))
  process.stdout.write(`${result.decision}: ${result.reason}\n`)
  process.exitCode = result.decision === "accepted" ? 0 : 1
}
