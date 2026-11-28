/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { fitReleaseBody, RELEASE_BODY_LIMIT } from "./release-notes-budget"

// Contract: the draft-release job's body never exceeds GitHub's 125,000-character limit (dev push run 46113507022
// failed with HTTP 422 on the rolling `next` draft).
describe("fitReleaseBody", () => {
  test("#given notes under the limit #when fitted #then they come back unchanged", () => {
    // given
    const lines = ["- abc1234 fix: one", "- def5678 feat: two"]

    // when
    const body = fitReleaseBody(lines, "v5.1.84")

    // then
    expect(body).toBe(lines.join("\n"))
  })

  test("#given notes over the limit #when fitted #then the newest whole lines stay and one line counts and links the rest", () => {
    // given
    const lines = Array.from({ length: 3000 }, (_, i) => `- ${String(i).padStart(7, "0")} fix: ${"x".repeat(60)}`)
    expect(lines.join("\n").length).toBeGreaterThan(RELEASE_BODY_LIMIT)

    // when
    const body = fitReleaseBody(lines, "v5.1.84")

    // then
    expect(body.length).toBeLessThanOrEqual(RELEASE_BODY_LIMIT)
    const out = body.split("\n")
    const kept = out.slice(0, -1)
    expect(kept).toEqual(lines.slice(0, kept.length))
    const omitted = lines.length - kept.length
    expect(out.at(-1)).toBe(
      `- ...and ${omitted} more changes: https://github.com/code-yeongyu/oh-my-openagent/compare/v5.1.84...dev (full notes: https://github.com/code-yeongyu/oh-my-openagent/blob/dev/CHANGELOG.md)`,
    )
  })
})
