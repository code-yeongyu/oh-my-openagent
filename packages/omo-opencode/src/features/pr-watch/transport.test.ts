import { describe, expect, test } from "bun:test"
import { GitHubPrWatchHost } from "./github"
import { GitHubReadDeferred, GitHubReadTransport } from "./transport"

function replay(lines: string) {
  const responses = lines.trim().split("\n").map(line => JSON.parse(line) as { status: number; headers?: Record<string, string>; body?: unknown })
  const calls: { url: string; headers: Headers; body?: unknown }[] = []
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), body: init?.body && JSON.parse(String(init.body)) })
    const row = responses.shift()
    if (!row) throw new Error("Unexpected replay request")
    return new Response(row.body === undefined ? null : JSON.stringify(row.body), { status: row.status, headers: row.headers })
  }) as typeof fetch
  return { request, calls }
}

// #9493 asks for one shared transport, authentication precedence, budgets and ETag behavior.
describe("shared GitHub PR watch transport", () => {
  test("REST and GraphQL share explicit token precedence and never invoke gh auth", async () => {
    const fixture = replay('{"status":200,"body":{"login":"alice"}}\n{"status":200,"body":{"data":{"viewer":{"login":"alice"}}}}')
    let authentications = 0
    const transport = new GitHubReadTransport({ env: { GH_TOKEN: " preferred ", GITHUB_TOKEN: "secondary" }, fetch: fixture.request, authToken: async () => { authentications++; return "fallback" } })
    await transport.rest("/user"); await transport.graphql("query { viewer { login } }")
    expect(authentications).toBe(0)
    expect(fixture.calls.every(call => call.headers.get("authorization") === "Bearer preferred")).toBe(true)
    expect(fixture.calls.map(call => call.url)).toEqual(["https://api.github.com/user", "https://api.github.com/graphql"])
  })
  test("concurrent API reads resolve gh auth once per host and enterprise credentials stay separate", async () => {
    const fixture = replay('{"status":200,"body":{}}\n{"status":200,"body":{}}')
    let authentications = 0
    const transport = new GitHubReadTransport({ host: "git.example.com", env: { GH_TOKEN: "public-only" }, fetch: fixture.request, authToken: async host => { expect(host).toBe("git.example.com"); authentications++; return "enterprise" } })
    await Promise.all([transport.rest("/user"), transport.graphql("query { viewer { login } }")])
    expect(authentications).toBe(1)
    expect(fixture.calls.map(call => call.url)).toEqual(["https://git.example.com/api/v3/user", "https://git.example.com/api/graphql"])
    expect(fixture.calls.every(call => call.headers.get("authorization") === "Bearer enterprise")).toBe(true)
  })
  test("dedicated Enterprise Cloud uses its API subdomain and cloud-token precedence", async () => {
    const fixture = replay('{"status":200,"body":{}}\n{"status":200,"body":{}}')
    const transport = new GitHubReadTransport({ host: "acme.ghe.com", env: { GH_TOKEN: "cloud", GH_ENTERPRISE_TOKEN: "server-only" }, fetch: fixture.request })
    await transport.rest("/user"); await transport.graphql("query { viewer { login } }")
    expect(fixture.calls.map(call => call.url)).toEqual(["https://api.acme.ghe.com/user", "https://api.acme.ghe.com/graphql"])
    expect(fixture.calls.every(call => call.headers.get("authorization") === "Bearer cloud")).toBe(true)
  })
  test("host credential cache expires after five minutes and invalidates immediately on 401", async () => {
    let now = 0, authentications = 0
    const fixture = replay('{"status":200,"body":{}}\n{"status":200,"body":{}}\n{"status":401,"body":{"message":"Bad credentials"}}\n{"status":200,"body":{}}\n{"status":200,"body":{}}')
    const transport = new GitHubReadTransport({ env: {}, fetch: fixture.request, now: () => now, authToken: async () => `token-${++authentications}` })
    await transport.rest("/user"); now = 299999; await transport.rest("/user")
    expect(authentications).toBe(1)
    await expect(transport.rest("/user")).rejects.toThrow("GitHub read failed (401)")
    await transport.rest("/user"); expect(authentications).toBe(2)
    now += 300000; await transport.rest("/user"); expect(authentications).toBe(3)
    expect(fixture.calls.map(call => call.headers.get("authorization"))).toEqual(["Bearer token-1", "Bearer token-1", "Bearer token-1", "Bearer token-2", "Bearer token-3"])
  })
  test("conditional REST read returns isolated cached JSON on 304", async () => {
    const fixture = replay('{"status":200,"headers":{"etag":"cached"},"body":{"login":"alice"}}\n{"status":304}')
    const transport = new GitHubReadTransport({ env: { GITHUB_TOKEN: "token" }, fetch: fixture.request })
    const first = await transport.rest<{ login: string }>("/user"); first.login = "modified"
    expect(await transport.rest("/user")).toEqual({ login: "alice" })
    expect(fixture.calls[1]!.headers.get("if-none-match")).toBe("cached")
  })
  test("primary GraphQL budget defers only GraphQL until reset; partial errors survive", async () => {
    let now = 1000
    const fixture = replay('{"status":200,"body":{"data":{"rateLimit":{"cost":2,"remaining":1,"resetAt":"1970-01-01T00:00:05Z"}},"errors":[{"path":["pr0"],"message":"Unavailable"}]}}\n{"status":200,"body":{"login":"alice"}}\n{"status":200,"body":{"data":{}}}')
    const transport = new GitHubReadTransport({ env: { GH_TOKEN: "token" }, fetch: fixture.request, now: () => now })
    const response = await transport.graphql("query1"); expect(response.errors?.length).toBe(1)
    await expect(transport.graphql("query2")).rejects.toBeInstanceOf(GitHubReadDeferred)
    expect(await transport.rest("/user")).toEqual({ login: "alice" })
    now = 5000; await transport.graphql("query2")
    expect(fixture.calls.length).toBe(3)
  })
  test("secondary limits defer both API surfaces and do not retry before deadline", async () => {
    let now = 1000
    const fixture = replay('{"status":403,"headers":{"retry-after":"2"},"body":{"message":"secondary rate limit"}}\n{"status":200,"body":{"data":{}}}')
    const transport = new GitHubReadTransport({ env: { GH_TOKEN: "token" }, fetch: fixture.request, now: () => now })
    await expect(transport.rest("/user")).rejects.toBeInstanceOf(GitHubReadDeferred)
    await expect(transport.graphql("query")).rejects.toBeInstanceOf(GitHubReadDeferred)
    expect(fixture.calls.length).toBe(1)
    now = 3000; await transport.graphql("query"); expect(fixture.calls.length).toBe(2)
  })
  test("ordinary permissions fail safely without a false rate-limit wait", async () => {
    const fixture = replay('{"status":403,"body":{"message":"private token-secret"}}\n{"status":200,"body":{}}')
    const transport = new GitHubReadTransport({ env: { GH_TOKEN: "token-secret" }, fetch: fixture.request })
    await expect(transport.rest("/user")).rejects.toThrow("GitHub read failed (403)")
    await transport.graphql("query"); expect(fixture.calls.length).toBe(2)
    await expect(transport.rest("//evil.example/user")).rejects.toThrow("Invalid GitHub REST path")
  })
})


// The persistent consumer must not acknowledge truncated pages (#9493).
describe("complete PR watch reads", () => {
  const context = (head: string, hasNextPage: boolean, endCursor: string | null, id: number) => ({ data: { repository: { pullRequest: {
    state: "OPEN", mergeable: "MERGEABLE", headRefOid: head,
    commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { pageInfo: { hasNextPage, endCursor }, nodes: [{ databaseId: id, name: "CI", status: "COMPLETED", conclusion: "SUCCESS", isRequired: true }] } } } }] },
  } } } })
  const transport = (fixture: ReturnType<typeof replay>) => new GitHubReadTransport({ env: { GH_TOKEN: "fixture" }, fetch: fixture.request })
  test("continues check context cursors and rejects a moving head", async () => {
    const fixture = replay([context("one", true, "cursor", 1), context("one", false, null, 2)].map(body => JSON.stringify({ status: 200, body })).join("\n"))
    expect((await new GitHubPrWatchHost(transport(fixture)).details("acme/widget#1")).checks.map(check => check.id)).toEqual(["run:1", "run:2"])
    expect((fixture.calls[1].body as { query: string }).query).toContain('after:"cursor"')
    const moved = replay([context("one", true, "cursor", 1), context("two", false, null, 2)].map(body => JSON.stringify({ status: 200, body })).join("\n"))
    await expect(new GitHubPrWatchHost(transport(moved)).details("acme/widget#1")).rejects.toThrow("head changed")
  })
  test("collects all REST comment pages and GraphQL review pages including inline replies", async () => {
    const remark = (id: number) => ({ node_id: `comment-${id}`, user: { login: "alice" }, updated_at: "2026-10-07", html_url: `https://example.test/${id}` })
    const reviews = (id: string, next: string | null) => ({ data: { repository: { pullRequest: { reviews: { nodes: [{ id, author: { login: "alice" }, updatedAt: "2026-10-07", url: "https://example.test/review" }], pageInfo: { hasNextPage: next !== null, endCursor: next } } } } } })
    const fixture = replay([Array.from({ length: 100 }, (_, i) => remark(i)), [remark(100)], [remark(101)], reviews("r1", "more"), reviews("r2", null)].map(body => JSON.stringify({ status: 200, body })).join("\n"))
    const result = await new GitHubPrWatchHost(transport(fixture)).activity("acme/widget#1")
    expect(result.remarks.length).toBe(104)
    expect(result.remarks.some(row => row.id === "comment-101")).toBe(true)
    expect(fixture.calls[1].url).toContain("page=2")
    expect(fixture.calls[2].url).toContain("/pulls/1/comments")
    const failed = replay([{ status: 200, body: Array.from({ length: 100 }, (_, i) => remark(i)) }, { status: 500, body: {} }].map(row => JSON.stringify(row)).join("\n"))
    await expect(new GitHubPrWatchHost(transport(failed)).activity("acme/widget#1")).rejects.toThrow("GitHub read failed")
  })
})
