/// <reference types="bun-types" />

import { afterAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  findMissingInstalledArtifacts,
  isSupportedPackageSpec,
  parseSmokeArgs,
  registryTarballUrl,
  registryWaitFromEnv,
  resolveCommittedLatestSpec,
} from "./published-install-smoke.mjs"

const TARBALL = "https://registry.npmjs.org/oh-my-openagent/-/oh-my-openagent-5.1.78.tgz"

// A fake registry whose tarball answers the given statuses in order (the last repeats), and a clock that
// only moves when the waiter sleeps, so the deadline is reached without real time passing.
function fakeRegistry(statuses: readonly number[], deadlineMs = 20 * 60_000) {
  let clock = 0
  const probes: { url: string; method: string | undefined }[] = []
  const sleeps: number[] = []
  const views: string[] = []
  return {
    probes,
    sleeps,
    views,
    options: {
      deadlineMs,
      delayMs: 15_000,
      viewVersion: (name: string, tag: string) => {
        views.push(`${name}@${tag}`)
        return "5.1.78"
      },
      fetchImpl: async (url: string, init?: { method?: string }) => {
        probes.push({ url, method: init?.method })
        return new Response(null, { status: statuses[Math.min(probes.length - 1, statuses.length - 1)] })
      },
      now: () => clock,
      sleep: async (ms: number) => {
        sleeps.push(ms)
        clock += ms
      },
      log: () => {},
    },
  }
}

const createdPluginPaths: string[] = []

async function createInstalledPlugin(options: { readonly withUltraworkSkill: boolean }): Promise<string> {
  const pluginPath = await mkdtemp(join(tmpdir(), "omo-smoke-plugin-"))
  createdPluginPaths.push(pluginPath)
  await mkdir(join(pluginPath, ".codex-plugin"), { recursive: true })
  await writeFile(join(pluginPath, ".codex-plugin", "plugin.json"), "{}")
  await writeFile(join(pluginPath, "package.json"), "{}")
  if (options.withUltraworkSkill) {
    await mkdir(join(pluginPath, "skills", "ultrawork"), { recursive: true })
    await writeFile(join(pluginPath, "skills", "ultrawork", "SKILL.md"), "---\nname: ultrawork\n---\n")
  }
  return pluginPath
}

afterAll(async () => {
  for (const pluginPath of createdPluginPaths) {
    await rm(pluginPath, { recursive: true, force: true })
  }
})

describe("published install smoke", () => {
  test("#given an installed plugin without the composed ultrawork skill #when artifacts are checked #then the missing path is reported", async () => {
    // given
    const pluginPath = await createInstalledPlugin({ withUltraworkSkill: false })

    // when
    const missing = findMissingInstalledArtifacts(pluginPath)

    // then
    expect(missing).toEqual([join("skills", "ultrawork", "SKILL.md")])
  })

  test("#given a fully installed plugin #when artifacts are checked #then nothing is reported", async () => {
    // given
    const pluginPath = await createInstalledPlugin({ withUltraworkSkill: true })

    // when
    const missing = findMissingInstalledArtifacts(pluginPath)

    // then
    expect(missing).toEqual([])
  })

  test("#given both payload sources #when smoke args are parsed #then the package spec and tarball path are separated", () => {
    // given
    const argv = ["--package=lazycodex-ai@latest", "--tarball=/tmp/omo.tgz", "--keep"]

    // when
    const args = parseSmokeArgs(argv)

    // then
    expect(args).toEqual({ packageSpec: "lazycodex-ai@latest", tarballPath: "/tmp/omo.tgz", keep: true })
  })

  test("#given specs carrying shell metacharacters #when they are checked #then none is accepted for packing", () => {
    // given
    const hostile = [
      "lazycodex-ai@latest|calc",
      "oh-my-openagent@5.0.0-beta.43>out.txt",
      "oh-my-openagent@5.0.0<in.txt",
      "oh-my-openagent@latest&whoami",
      "oh-my-openagent@^5.0.0",
    ]

    // when / then
    for (const spec of hostile) {
      expect(isSupportedPackageSpec(spec)).toBe(false)
    }
  })

  test("#given latest points at a version whose tarball 404s then 200s #when resolved #then it waits and returns that exact version", async () => {
    // given
    const registry = fakeRegistry([404, 404, 200])

    // when
    const spec = await resolveCommittedLatestSpec("oh-my-openagent@latest", registry.options)

    // then
    expect(spec).toBe("oh-my-openagent@5.1.78")
    expect(registry.views).toEqual(["oh-my-openagent@latest"])
    expect(registry.probes).toEqual([
      { url: TARBALL, method: "HEAD" },
      { url: TARBALL, method: "HEAD" },
      { url: TARBALL, method: "HEAD" },
    ])
    expect(registry.sleeps).toEqual([15_000, 15_000])
  })

  test("#given the tarball stays 404 past the deadline #when resolved #then it fails with the named registry reason", async () => {
    // given
    const registry = fakeRegistry([404])

    // when / then
    await expect(resolveCommittedLatestSpec("oh-my-openagent@latest", registry.options)).rejects.toThrow(
      new Error("registry not committed: oh-my-openagent@5.1.78 tarball 404 for 20 min"),
    )
    expect(registry.sleeps.reduce((total, ms) => total + ms, 0)).toBe(20 * 60_000)
  })

  test("#given a deadline under one minute #when the tarball never commits #then the failure names the wait in seconds", async () => {
    // given
    const registry = fakeRegistry([404], 30_000)

    // when / then
    await expect(resolveCommittedLatestSpec("oh-my-openagent@latest", registry.options)).rejects.toThrow(
      new Error("registry not committed: oh-my-openagent@5.1.78 tarball 404 for 30 s"),
    )
  })

  test("#given no wait overrides #when read from the env #then the 20 min deadline and 15 s poll apply", () => {
    // given / when / then
    expect(registryWaitFromEnv({})).toEqual({ deadlineMs: 1_200_000, delayMs: 15_000 })
    expect(
      registryWaitFromEnv({
        PUBLISHED_SMOKE_REGISTRY_WAIT_SECONDS: "90",
        PUBLISHED_SMOKE_REGISTRY_POLL_SECONDS: "2.5",
      }),
    ).toEqual({ deadlineMs: 90_000, delayMs: 2_500 })
  })

  test("#given a non-numeric, empty, zero or negative override #when read from the env #then it fails naming the variable and value", () => {
    // given
    const invalid: [string, string][] = [
      ["PUBLISHED_SMOKE_REGISTRY_WAIT_SECONDS", "20m"],
      ["PUBLISHED_SMOKE_REGISTRY_WAIT_SECONDS", ""],
      ["PUBLISHED_SMOKE_REGISTRY_POLL_SECONDS", "0"],
      ["PUBLISHED_SMOKE_REGISTRY_POLL_SECONDS", "-5"],
      ["PUBLISHED_SMOKE_REGISTRY_POLL_SECONDS", "Infinity"],
    ]

    // when / then
    for (const [key, value] of invalid) {
      expect(() => registryWaitFromEnv({ [key]: value })).toThrow(new Error(`invalid ${key}: ${value}`))
    }
  })

  test("#given the tarball is already committed #when resolved #then it proceeds without waiting", async () => {
    // given
    const registry = fakeRegistry([200])

    // when
    const spec = await resolveCommittedLatestSpec("oh-my-openagent@latest", registry.options)

    // then
    expect(spec).toBe("oh-my-openagent@5.1.78")
    expect(registry.probes).toHaveLength(1)
    expect(registry.sleeps).toEqual([])
  })

  test("#given a beta or exact-version spec #when resolved #then it is returned untouched with no registry call", async () => {
    // given
    const registry = fakeRegistry([404])

    // when / then
    expect(await resolveCommittedLatestSpec("oh-my-openagent@beta", registry.options)).toBe("oh-my-openagent@beta")
    expect(await resolveCommittedLatestSpec("lazycodex-ai@5.1.78", registry.options)).toBe("lazycodex-ai@5.1.78")
    expect(registry.views).toEqual([])
    expect(registry.probes).toEqual([])
  })

  test("#given scoped and unscoped packages #when the tarball url is built #then the scope stays only in the path prefix", () => {
    // given / when / then
    expect(registryTarballUrl("oh-my-openagent", "5.1.78")).toBe(TARBALL)
    expect(registryTarballUrl("@scope/name", "1.2.3")).toBe("https://registry.npmjs.org/@scope/name/-/name-1.2.3.tgz")
  })

  test("#given plain dist-tag and exact-version specs #when they are checked #then both are accepted", () => {
    // given / when / then
    expect(isSupportedPackageSpec("lazycodex-ai@latest")).toBe(true)
    expect(isSupportedPackageSpec("oh-my-openagent@5.0.0-beta.43")).toBe(true)
    expect(isSupportedPackageSpec("@scope/pkg@beta")).toBe(true)
  })
})
