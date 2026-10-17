import { describe, expect, spyOn, test } from "bun:test"
import { fetchGitHubReleases } from "../compiled-update"

describe("compiled update GitHub authentication", () => {
  const cases = [
    { name: "GH_TOKEN alone", GH_TOKEN: "gh-test-token", GITHUB_TOKEN: undefined, authorization: "Bearer gh-test-token" },
    { name: "GITHUB_TOKEN alone", GH_TOKEN: undefined, GITHUB_TOKEN: "github-test-token", authorization: "Bearer github-test-token" },
    { name: "both tokens", GH_TOKEN: "gh-test-token", GITHUB_TOKEN: "github-test-token", authorization: "Bearer gh-test-token" },
    { name: "empty GH_TOKEN", GH_TOKEN: "", GITHUB_TOKEN: "github-test-token", authorization: "Bearer github-test-token" },
    { name: "missing tokens", GH_TOKEN: undefined, GITHUB_TOKEN: undefined, authorization: null },
    { name: "empty tokens", GH_TOKEN: "", GITHUB_TOKEN: "", authorization: null },
  ]

  for (const fixture of cases) {
    test(`#given ${fixture.name} #when releases are fetched #then the configured authentication is sent`, async () => {
      // given
      const original = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN }
      for (const key of ["GH_TOKEN", "GITHUB_TOKEN"] as const) {
        const value = fixture[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json([]))

      try {
        // when
        await fetchGitHubReleases()

        // then
        expect(fetchSpy).toHaveBeenCalledTimes(1)
        const headers = new Headers(fetchSpy.mock.calls[0]?.[1]?.headers)
        expect(headers.get("Authorization")).toBe(fixture.authorization)
      } finally {
        fetchSpy.mockRestore()
        for (const key of ["GH_TOKEN", "GITHUB_TOKEN"] as const) {
          const value = original[key]
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }
    })
  }
})
