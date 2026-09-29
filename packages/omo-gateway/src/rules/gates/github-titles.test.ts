import { describe, expect, it } from "bun:test"
import { createGithubTitleCache, GITHUB_TITLE_TTL_MS } from "./github-titles"

describe("GitHub title cache", () => {
  it("#given a cached title #when asked again within the TTL #then no second lookup; after the TTL #then it refetches", async () => {
    let clock = 0
    let version = 1
    const calls: string[] = []
    const cache = createGithubTitleCache({
      now: () => clock,
      fetchTitle: async (owner, repo, number) => {
        calls.push(`${owner}/${repo}#${number}`)
        return `title v${version}`
      },
    })
    expect(await cache.title("acme", "widget", 1)).toBe("title v1")
    version = 2
    clock = GITHUB_TITLE_TTL_MS - 1
    expect(await cache.title("ACME", "Widget", 1)).toBe("title v1")
    clock = GITHUB_TITLE_TTL_MS
    expect(await cache.title("acme", "widget", 1)).toBe("title v2")
    expect(calls).toEqual(["acme/widget#1", "acme/widget#1"])
  })

  it("#given a failed lookup #when asked again #then the failure is not cached", async () => {
    let online = false
    const cache = createGithubTitleCache({
      fetchTitle: async () => {
        if (!online) throw new Error("offline")
        return "back"
      },
    })
    await expect(cache.title("acme", "widget", 2)).rejects.toThrow("offline")
    online = true
    expect(await cache.title("acme", "widget", 2)).toBe("back")
  })
})
