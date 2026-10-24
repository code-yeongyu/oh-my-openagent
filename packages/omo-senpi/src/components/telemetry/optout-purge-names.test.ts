import { describe, expect, test } from "bun:test"

import { summaryFileName } from "./optout-purge.test-support"

// Guards the names every session_summary assertion compares against ("owners/", "pending/"): on Windows the
// listing joins with "\\", and a name that keeps it hides the owner entry from the filters (#11171).
describe("summary file names", () => {
  test("#given a Windows-shaped path under the summary dir #when named #then it uses / like every assertion", () => {
    expect(summaryFileName("C:\\state\\session-summary", "C:\\state\\session-summary\\owners\\6872.json", "\\")).toBe("owners/6872.json")
    expect(summaryFileName("C:\\state\\session-summary", "C:\\state\\session-summary\\pending\\0395eae0.json", "\\")).toBe("pending/0395eae0.json")
  })

  test("#given a POSIX path under the summary dir #when named #then it is unchanged", () => {
    expect(summaryFileName("/state/session-summary", "/state/session-summary/owners/6872.json", "/")).toBe("owners/6872.json")
  })
})
