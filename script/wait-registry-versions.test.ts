import { describe, expect, test } from "bun:test"
import { parseSpec, pendingSpecs, platformPackageNames, waitForRegistryVersions, type RegistryFetch } from "./wait-registry-versions.mjs"

const registry = (served: Record<string, string>): RegistryFetch => async (url) => {
  const parts = new URL(url).pathname.split("/").filter(Boolean)
  const name = decodeURIComponent(parts.slice(0, -1).join("/"))
  const version = served[name]
  return version === undefined ? new Response("not found", { status: 404 }) : Response.json({ name, version })
}

describe("wait-registry-versions", () => {
  test("#given one package npm never served #when the window closes #then it fails naming only that package and why", async () => {
    const result = await waitForRegistryVersions({
      specs: ["omo-ai@5.1.38", "oh-my-openagent@5.1.38", "oh-my-openagent-linux-x64@5.1.38"],
      deadlineMs: 0,
      delayMs: 0,
      fetchImpl: registry({ "omo-ai": "5.1.38", "oh-my-openagent-linux-x64": "5.1.38" }),
      log: () => {},
    })
    expect(result).toEqual({ ok: false, pending: [{ spec: "oh-my-openagent@5.1.38", reason: "HTTP 404" }] })
  })

  test("#given packages at different versions #when waited together #then one window checks each at its own version", async () => {
    const result = await waitForRegistryVersions({
      specs: ["omo-ai@5.2.0-0.beta.1", "oh-my-openagent@5.2.0-beta.1"],
      deadlineMs: 0,
      delayMs: 0,
      fetchImpl: registry({ "omo-ai": "5.2.0-0.beta.1", "oh-my-openagent": "5.2.0-beta.1" }),
      log: () => {},
    })
    expect(result.ok).toBe(true)
  })

  test("#given a package that lands on the second probe #when waiting #then it succeeds", async () => {
    let calls = 0
    const late: RegistryFetch = async () => {
      calls++
      return calls === 1 ? new Response("", { status: 404 }) : Response.json({ version: "5.1.38" })
    }
    const result = await waitForRegistryVersions({ specs: ["oh-my-openagent@5.1.38"], deadlineMs: 60_000, delayMs: 0, fetchImpl: late, log: () => {} })
    expect(result.ok).toBe(true)
  })

  test("#given the registry serves a different version or the probe throws #when checked #then each stays pending with its reason", async () => {
    expect(await pendingSpecs(["omo-ai@5.1.38"], registry({ "omo-ai": "5.1.37" }))).toEqual([{ spec: "omo-ai@5.1.38", reason: "serves 5.1.37" }])
    const failing: RegistryFetch = async () => { throw new Error("socket hang up") }
    expect(await pendingSpecs(["omo-ai@5.1.38"], failing)).toEqual([{ spec: "omo-ai@5.1.38", reason: "probe failed: socket hang up" }])
  })

  test("#given a probe #when sent #then it bypasses caches and carries a bounded timeout", async () => {
    const seen: { headers?: Record<string, string>; signal?: AbortSignal }[] = []
    await pendingSpecs(["omo-ai@5.1.38"], async (_url, init) => {
      seen.push(init ?? {})
      return Response.json({ version: "5.1.38" })
    })
    expect(seen[0]?.headers?.["Cache-Control"]).toBe("no-cache")
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal)
  })

  test("#given a scoped spec #when parsed #then the scope stays in the name", () => {
    expect(parseSpec("@code-yeongyu/senpi@2026.10.19")).toEqual({ name: "@code-yeongyu/senpi", version: "2026.10.19" })
  })
})

describe("wait-registry-versions overall deadline", () => {
  test("#given probes that are slow and a package that never lands #when one 60-minute deadline is shared #then it fails on time naming what is missing", async () => {
    let now = 0
    const minute = 60_000
    let probes = 0
    const slow: RegistryFetch = async (url) => {
      probes++
      now += 4 * minute
      return url.includes("oh-my-openagent/") ? new Response("", { status: 404 }) : Response.json({ version: "5.1.38" })
    }
    const result = await waitForRegistryVersions({
      specs: ["omo-ai@5.1.38", "oh-my-openagent@5.1.38"],
      deadlineMs: 60 * minute,
      delayMs: 15_000,
      fetchImpl: slow,
      now: () => now,
      sleep: async (ms) => { now += ms },
      log: () => {},
    })
    expect(result).toEqual({ ok: false, pending: [{ spec: "oh-my-openagent@5.1.38", reason: "HTTP 404" }] })
    expect(now).toBeLessThanOrEqual(60 * minute + 4 * minute)
    expect(probes).toBeLessThan(20)
  })
})

describe("platformPackageNames", () => {
  test("#given the root manifest #when platform packages are derived #then both families come from optionalDependencies", () => {
    expect(platformPackageNames({ optionalDependencies: { "oh-my-opencode-linux-x64": "5.1.38", "oh-my-opencode-windows-arm64": "5.1.38", "left-pad": "1.0.0" } })).toEqual([
      "oh-my-opencode-linux-x64",
      "oh-my-openagent-linux-x64",
      "oh-my-opencode-windows-arm64",
      "oh-my-openagent-windows-arm64",
    ])
  })

  test("#given a manifest with no platform packages #when derived #then it fails closed", () => {
    expect(() => platformPackageNames({})).toThrow(/no oh-my-opencode-<platform> package/)
  })
})
