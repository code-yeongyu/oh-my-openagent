import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"

import { candidateDigest, gateReport, renderReport } from "./gate"
import { EARLIER, HEAD, input } from "./gate-fixture"
import { REPO_ROOT } from "./registry"
import { verifyReview } from "./verify-review"

// Negative controls of design 7.4 and 7.6 for the candidate tier's verifier (amendment 3, review 6061267823 H4): the
// candidates' digest at the pull request's own head, the author's body line and a CLEAR verdict carrying that digest.

describe("negative controls: the candidate verifier (7.4, 7.6, review 6061267823 H4)", () => {
  const body = "SDK-Parity-Unchanged: yes\n"
  const output = renderReport(gateReport(input({ changedFiles: ["packages/omo-native/bin/lib/thread.js"], body })))
  const digest = candidateDigest(HEAD, ["threads.send"])
  const clear = (lines: string) => `Verdict: CLEAR at ${HEAD}\n${lines}`

  test("#given a candidate and a CLEAR without the reviewed line #then the verifier withholds", () => {
    expect(verifyReview(output, body, clear(""))).toEqual({
      decision: "withheld",
      reason: `the verdict lacks SDK-Parity-Reviewed; the check printed 1 candidate(s), digest ${digest}`,
    })
  })

  test("#given the same change with the matching line at that head #then the verifier accepts", () => {
    expect(verifyReview(output, body, clear(`SDK-Parity-Reviewed: ${digest}\n`)).decision).toBe("accepted")
  })

  test("#given a digest the check did not print #then the verifier withholds", () => {
    const other = candidateDigest(HEAD, ["threads.close"])
    expect(verifyReview(output, body, clear(`SDK-Parity-Reviewed: ${other}\n`))).toEqual({
      decision: "withheld",
      reason: `the verdict carries ${other}, a digest the check did not print at ${HEAD.slice(0, 10)} (${digest})`,
    })
  })

  test("#given a verdict given at an earlier head #then the verifier withholds", () => {
    const earlier = candidateDigest(EARLIER, ["threads.send"])
    expect(verifyReview(output, body, `Verdict: CLEAR at ${EARLIER}\nSDK-Parity-Reviewed: ${earlier}\n`)).toEqual({
      decision: "withheld",
      reason: `the verdict was not given at ${HEAD} (it names ${EARLIER})`,
    })
  })

  test("#given equal outcomes and no verdict line at all #then the verifier withholds; with no candidate it accepts", () => {
    expect(verifyReview(output, body, "").decision).toBe("withheld")
    expect(verifyReview(renderReport(gateReport(input())), "", "").decision).toBe("accepted")
  })

  test("#given a FIX_FIRST carrying the right line, or a body without the author's line #then the verifier withholds", () => {
    expect(verifyReview(output, body, `FIX_FIRST at ${HEAD}\nSDK-Parity-Reviewed: ${digest}\n`)).toEqual({
      decision: "withheld",
      reason: "the verdict is not a CLEAR",
    })
    expect(verifyReview(output, "", clear(`SDK-Parity-Reviewed: ${digest}\n`))).toEqual({
      decision: "withheld",
      reason: "the pull request body lacks the author's SDK-Parity-Unchanged: yes",
    })
  })

  test("#given a checkout that is not the pull request head #then the gate stops before comparing", () => {
    const run = spawnSync(
      process.execPath,
      [join(REPO_ROOT, "script/sdk-parity/gate-cli.ts"), "--expect-head", "0".repeat(40)],
      { cwd: REPO_ROOT, encoding: "utf8" },
    )
    expect(run.status).toBe(1)
    expect(run.stderr).toContain(`not the pull request head ${"0".repeat(40)}; check out the head itself`)
  })
})
