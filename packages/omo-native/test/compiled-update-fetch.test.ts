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
    { name: "padded GH_TOKEN", GH_TOKEN: "  gh-test-token  ", GITHUB_TOKEN: "github-test-token", authorization: "Bearer gh-test-token" },
    { name: "whitespace GH_TOKEN", GH_TOKEN: " \t ", GITHUB_TOKEN: "  github-test-token  ", authorization: "Bearer github-test-token" },
    { name: "padded GITHUB_TOKEN", GH_TOKEN: undefined, GITHUB_TOKEN: "  github-test-token  ", authorization: "Bearer github-test-token" },
    { name: "whitespace tokens", GH_TOKEN: " \t ", GITHUB_TOKEN: " \t ", authorization: null },
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

  test("#given a rejected token #when anonymous lookup succeeds #then it returns releases without authentication", async () => {
    const original = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN }
    const releases = [{ tag_name: "v9.9.10", assets: [] }]
    const fetchSpy = spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected release lookup"))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json(releases))

    try {
      process.env.GH_TOKEN = "expired-test-token"
      delete process.env.GITHUB_TOKEN

      expect(await fetchGitHubReleases()).toEqual(releases)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer expired-test-token")
      expect(new Headers(fetchSpy.mock.calls[1]?.[1]?.headers).get("Authorization")).toBeNull()
      expect(fetchSpy.mock.calls[1]?.[0]).toBe(fetchSpy.mock.calls[0]?.[0])
    } finally {
      fetchSpy.mockRestore()
      for (const key of ["GH_TOKEN", "GITHUB_TOKEN"] as const) {
        if (original[key] === undefined) delete process.env[key]
        else process.env[key] = original[key]
      }
    }
  })

  for (const failure of [401, 403, 500, "network", "json"] as const) {
    test(`#given a rejected token #when anonymous retry fails with ${failure} #then it names the variables without leaking credentials`, async () => {
      const original = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN }
      const fetchSpy = spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("unexpected release lookup"))
        .mockResolvedValueOnce(new Response("expired-test-token", { status: 401 }))
      if (failure === "network") fetchSpy.mockRejectedValueOnce(new Error("expired-test-token"))
      else if (failure === "json") fetchSpy.mockResolvedValueOnce(new Response("expired-test-token"))
      else fetchSpy.mockResolvedValueOnce(new Response("secondary-test-token", { status: failure }))

      try {
        process.env.GH_TOKEN = "expired-test-token"
        process.env.GITHUB_TOKEN = "secondary-test-token"

        try {
          await fetchGitHubReleases()
          throw new Error("expected release lookup to fail")
        } catch (error) {
          expect(error).toBeInstanceOf(Error)
          if (error instanceof Error) {
            expect(error.message).toContain("GH_TOKEN")
            expect(error.message).toContain("GITHUB_TOKEN")
            expect(error.message).not.toContain("expired-test-token")
            expect(error.message).not.toContain("secondary-test-token")
          }
        }
        expect(fetchSpy).toHaveBeenCalledTimes(2)
        expect(new Headers(fetchSpy.mock.calls[1]?.[1]?.headers).get("Authorization")).toBeNull()
      } finally {
        fetchSpy.mockRestore()
        for (const key of ["GH_TOKEN", "GITHUB_TOKEN"] as const) {
          if (original[key] === undefined) delete process.env[key]
          else process.env[key] = original[key]
        }
      }
    })
  }

  for (const fixture of [
    { token: undefined, status: 401 },
    { token: undefined, status: 403 },
    { token: "gh-test-token", status: 403 },
    { token: "gh-test-token", status: 500 },
  ]) {
    test(`#given ${fixture.token ? "an authenticated" : "an anonymous"} lookup #when GitHub answers ${fixture.status} #then it does not retry`, async () => {
      const original = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN }
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: fixture.status }))
      try {
        if (fixture.token === undefined) delete process.env.GH_TOKEN
        else process.env.GH_TOKEN = fixture.token
        delete process.env.GITHUB_TOKEN

        await expect(fetchGitHubReleases()).rejects.toThrow(String(fixture.status))
        expect(fetchSpy).toHaveBeenCalledTimes(1)
      } finally {
        fetchSpy.mockRestore()
        for (const key of ["GH_TOKEN", "GITHUB_TOKEN"] as const) {
          if (original[key] === undefined) delete process.env[key]
          else process.env[key] = original[key]
        }
      }
    })
  }
})
