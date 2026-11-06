import { expect, test } from "bun:test"
import { isReleaseStatePr } from "./release-pr-marker.ts"

const real = {
  branch: "release/v5.1.39-source-state",
  title: "release: v5.1.39",
  body: "Automated release-state PR for v5.1.39. This must merge before npm publication starts so protected-branch push failures cannot create a half-published release.",
}

test("the PR publish.yml opens is recognised (prerelease versions too)", () => {
  expect(isReleaseStatePr(real)).toBe(true)
  expect(isReleaseStatePr({ branch: "release/v5.2.0-beta.1-source-state", title: "release: v5.2.0-beta.1", body: "Automated release-state PR for v5.2.0-beta.1. x" })).toBe(true)
})

test("a release/* branch with any other title, body or a mismatched version is not a release PR", () => {
  expect(isReleaseStatePr({ ...real, branch: "release/hotfix" })).toBe(false)
  expect(isReleaseStatePr({ ...real, title: "release: v5.1.40" })).toBe(false)
  expect(isReleaseStatePr({ ...real, title: "chore: release v5.1.39" })).toBe(false)
  expect(isReleaseStatePr({ ...real, body: "Please merge" })).toBe(false)
  expect(isReleaseStatePr({ ...real, body: "Automated release-state PR for v5.1.38. x" })).toBe(false)
})
