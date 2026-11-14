import { describe, expect, test } from "bun:test"
import {
  decideHostedMacosLive,
  formatRow,
  IMAGES,
  LEDGER_HEADER,
  type LedgerRow,
  mergeLedgers,
  parseLedger,
  QUESTIONS,
  rerunCommand,
  unsupportedHostReason,
  type Verdict,
} from "./hosted-macos-live-ledger.ts"

function fullLedger(verdictFor: (question: string, image: string) => Verdict): LedgerRow[] {
  return IMAGES.flatMap((image) =>
    QUESTIONS.map((question) => ({
      question,
      image,
      verdict: verdictFor(question, image),
      evidence: `measured ${question}`,
      rerun: rerunCommand(question, image),
    })),
  )
}

describe("ledger rows", () => {
  test("a row with tabs or line breaks in its evidence stays one five-cell line", () => {
    const line = formatRow({ question: "q1", image: "macos-15", verdict: "CONFIRMS", evidence: "a\tb\nc", rerun: "r" })
    expect(line.split("\t")).toEqual(["q1", "macos-15", "CONFIRMS", "a b c", "r"])
  })

  test("parse refuses an empty verdict or rerun cell", () => {
    expect(() => parseLedger(`${LEDGER_HEADER}\nq1\tmacos-15\t\tevidence\trerun\n`)).toThrow("unknown verdict")
    expect(() => parseLedger(`${LEDGER_HEADER}\nq1\tmacos-15\tCONFIRMS\tevidence\t\n`)).toThrow("empty cell")
  })

  test("merge orders fragments by image then question and refuses a duplicate pair", () => {
    const rows = fullLedger(() => "CONFIRMS")
    const fragment = (image: string) =>
      `${[
        LEDGER_HEADER,
        ...rows
          .filter((row) => row.image === image)
          .reverse()
          .map(formatRow),
      ].join("\n")}\n`
    const merged = parseLedger(mergeLedgers([fragment("macos-26"), fragment("macos-15")]))
    expect(merged).toHaveLength(16)
    expect(merged.map((row) => `${row.image}:${row.question}`).slice(0, 2)).toEqual(["macos-15:q1", "macos-15:q2"])
    expect(() => mergeLedgers([fragment("macos-15"), fragment("macos-15")])).toThrow(
      /^duplicate ledger row q\d@macos-15$/,
    )
  })
})

describe("HOSTED_MACOS_LIVE decision", () => {
  test("yes only when q2, q3, q4 and q6 confirm on both images", () => {
    expect(decideHostedMacosLive(fullLedger((question) => (question === "q7" ? "CONTRADICTS" : "CONFIRMS")))).toBe(
      "yes",
    )
  })

  test("one live-tier question that is refused on one image makes it no", () => {
    const rows = fullLedger((question, image) =>
      question === "q6" && image === "macos-26" ? "CONTRADICTS" : "CONFIRMS",
    )
    expect(decideHostedMacosLive(rows)).toBe("no")
  })

  test("a missing image is unmeasured, never a clean no", () => {
    const rows = fullLedger(() => "CONTRADICTS").filter((row) => row.image === "macos-15")
    expect(decideHostedMacosLive(rows)).toBe("unmeasured")
  })

  test("an UNMEASURED live-tier row is unmeasured even beside a measured refusal", () => {
    const rows = fullLedger((question, image) =>
      question === "q4" && image === "macos-26" ? "UNMEASURED" : question === "q3" ? "CONTRADICTS" : "CONFIRMS",
    )
    expect(decideHostedMacosLive(rows)).toBe("unmeasured")
  })
})

describe("host guard", () => {
  const hosted = { platform: "darwin", githubActions: "true", runnerEnvironment: "github-hosted", image: "macos-15" }

  test("a GitHub-hosted macOS runner with a known image proceeds", () => {
    expect(unsupportedHostReason(hosted)).toBeNull()
  })

  test("Linux, a self-hosted Mac and an unknown image are refused", () => {
    expect(unsupportedHostReason({ ...hosted, platform: "linux" })).toContain("not darwin")
    expect(unsupportedHostReason({ ...hosted, runnerEnvironment: "self-hosted" })).toContain("github-hosted")
    expect(unsupportedHostReason({ ...hosted, githubActions: undefined })).toContain("GITHUB_ACTIONS")
    expect(unsupportedHostReason({ ...hosted, image: "macos-14" })).toContain("PROBE_IMAGE")
  })
})
