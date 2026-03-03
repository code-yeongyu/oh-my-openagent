import { describe, expect, it } from "bun:test"

import { getSuggestedInstallTag } from "./system-loaded-version"

describe("system loaded version", () => {
  describe("getSuggestedInstallTag", () => {
    it("returns prerelease channel when current version is prerelease", () => {
      //#given
      const currentVersion = "3.2.0-beta.4"

      //#when
      const installTag = getSuggestedInstallTag(currentVersion)

      //#then
      expect(installTag).toBe("beta")
    })
  })
})
