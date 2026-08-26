import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { preflightMemoryModels, resetModelPreflightCacheForTests } from "./model-preflight"
import type { MemoryModelChain } from "./memory-model-attempts"

const roots: string[] = []
afterEach(async () => {
  resetModelPreflightCacheForTests()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const candidates: MemoryModelChain = [
  { model: "extension-only/primary", thinking: "off" },
  { model: "builtin/fallback", thinking: "minimal" },
]

async function fixture(body: string): Promise<{
  readonly root: string
  readonly launch: { readonly command: string; readonly prefixArgs: readonly string[] }
  readonly config: string
}> {
  const root = await mkdtemp(join(tmpdir(), "memory-model-preflight-"))
  roots.push(root)
  const launcher = join(root, "fake-senpi.mjs")
  const config = join(root, "omo.jsonc")
  await writeFile(launcher, `${body}\n`, "utf8")
  await writeFile(config, "{}\n", "utf8")
  return { root, launch: { command: process.execPath, prefixArgs: [launcher] }, config }
}

describe("preflightMemoryModels", () => {
  test("#given a clean child catalog #when candidates are preflighted #then only child-visible candidates remain in order", async () => {
    // given
    const item = await fixture('process.stdout.write("builtin/fallback\\nother/model\\n")')

    // when
    const result = await preflightMemoryModels({
      candidates,
      launch: item.launch,
      env: { PATH: process.env.PATH },
      configSources: [{ path: item.config, exists: true }],
    })

    // then
    expect(result).toEqual({
      kind: "filtered",
      candidates: [{ model: "builtin/fallback", thinking: "minimal" }],
      rejected: [{ model: "extension-only/primary", cause: "model_not_visible" }],
    })
  })

  test("#given the same launcher and config mtime #when preflight runs twice #then the child catalog is probed once", async () => {
    // given
    const item = await fixture(`
import { appendFileSync } from "node:fs"
appendFileSync(process.env.PROBE_LOG, "probe\\n")
process.stdout.write("builtin/fallback\\n")
`)
    const probeLog = join(item.root, "probes.log")
    const input = {
      candidates,
      launch: item.launch,
      env: { PATH: process.env.PATH, PROBE_LOG: probeLog },
      configSources: [{ path: item.config, exists: true }],
    }

    // when
    await preflightMemoryModels(input)
    await preflightMemoryModels(input)

    // then
    expect(await Bun.file(probeLog).text()).toBe("probe\n")
  })

  test("#given a cached negative catalog #when preflight repeats before expiry #then it preserves reactive attempts instead of throwing none_visible", async () => {
    // given
    const item = await fixture(`
import { appendFileSync } from "node:fs"
appendFileSync(process.env.PROBE_LOG, "probe\\n")
process.stdout.write("other/model\\n")
`)
    const probeLog = join(item.root, "probes.log")
    const input = {
      candidates,
      launch: item.launch,
      env: { PATH: process.env.PATH, PROBE_LOG: probeLog },
      configSources: [{ path: item.config, exists: true }],
      now: () => 1_000,
    }
    const fresh = await preflightMemoryModels(input)

    // when
    const cached = await preflightMemoryModels(input)

    // then
    expect(fresh).toEqual({
      kind: "none_visible",
      rejected: candidates.map((candidate) => ({ model: candidate.model, cause: "model_not_visible" })),
    })
    expect(cached).toEqual({ kind: "unavailable", candidates })
    expect(await Bun.file(probeLog).text()).toBe("probe\n")
  })

  test("#given a cached negative catalog #when its ttl expires #then preflight probes again and observes newly visible credentials", async () => {
    // given
    const item = await fixture(`
import { appendFileSync, existsSync } from "node:fs"
appendFileSync(process.env.PROBE_LOG, "probe\\n")
process.stdout.write(existsSync(process.env.AUTH_READY) ? "builtin/fallback\\n" : "other/model\\n")
`)
    const probeLog = join(item.root, "probes.log")
    const authReady = join(item.root, "auth-ready")
    let now = 1_000
    const input = {
      candidates,
      launch: item.launch,
      env: { PATH: process.env.PATH, PROBE_LOG: probeLog, AUTH_READY: authReady },
      configSources: [{ path: item.config, exists: true }],
      now: () => now,
    }
    expect((await preflightMemoryModels(input)).kind).toBe("none_visible")
    await writeFile(authReady, "ready\n", "utf8")
    now += 2 * 60_000

    // when
    const refreshed = await preflightMemoryModels(input)

    // then
    expect(refreshed).toEqual({
      kind: "filtered",
      candidates: [{ model: "builtin/fallback", thinking: "minimal" }],
      rejected: [{ model: "extension-only/primary", cause: "model_not_visible" }],
    })
    expect(await Bun.file(probeLog).text()).toBe("probe\nprobe\n")
  })

  test("#given a changed config mtime #when preflight runs again #then it refreshes the child catalog", async () => {
    // given
    const item = await fixture(`
import { appendFileSync } from "node:fs"
appendFileSync(process.env.PROBE_LOG, "probe\\n")
process.stdout.write("builtin/fallback\\n")
`)
    const probeLog = join(item.root, "probes.log")
    const input = {
      candidates,
      launch: item.launch,
      env: { PATH: process.env.PATH, PROBE_LOG: probeLog },
      configSources: [{ path: item.config, exists: true }],
    }
    await preflightMemoryModels(input)
    const before = await stat(item.config)
    await writeFile(item.config, "{\n}\n", "utf8")
    await Bun.sleep(1)
    const after = await stat(item.config)
    if (after.mtimeMs === before.mtimeMs) await writeFile(item.config, "{\n  // changed\n}\n", "utf8")

    // when
    await preflightMemoryModels(input)

    // then
    expect((await Bun.file(probeLog).text()).trim().split("\n")).toHaveLength(2)
  })

  test("#given a launcher whose grandchild holds the output pipes #when the probe times out #then it degrades without waiting for the grandchild", async () => {
    // given
    const item = await fixture("")
    const wrapper = join(item.root, "wrapper.mjs")
    const grandchildPidPath = join(item.root, "grandchild.pid")
    await writeFile(wrapper, `
import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"
const child = spawn(process.execPath, ["-e", "setInterval(() => undefined, 30_000)"], { stdio: ["ignore", "inherit", "inherit"] })
writeFileSync(process.env.GRANDCHILD_PID, String(child.pid))
setInterval(() => undefined, 30_000)
`, "utf8")
    // Windows runners pay a far larger cost to spawn process.execPath plus a grandchild, so the outer
    // wall-clock bound is platform-scoped. The injected probe timeout stays at 50ms on every platform,
    // so an unbounded hang still blows past even the Windows budget.
    const outerBoundMs = process.platform === "win32" ? 5000 : 500
    const startedAt = Date.now()
    const probe = preflightMemoryModels({
      candidates,
      launch: { command: process.execPath, prefixArgs: [wrapper] },
      env: { PATH: process.env.PATH, GRANDCHILD_PID: grandchildPidPath },
      configSources: [{ path: item.config, exists: true }],
      timeoutMs: 50,
    })
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await stat(grandchildPidPath)
        break
      } catch {
        await new Promise<void>((resolve) => setTimeout(resolve, 1))
      }
    }
    let cleanupPid: number | undefined

    // when
    const result = await Promise.race([
      probe,
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), outerBoundMs)),
    ]).finally(async () => {
      try {
        cleanupPid = Number((await readFile(grandchildPidPath, "utf8")).trim())
        process.kill(cleanupPid, "SIGKILL")
      } catch {
        // The fixed path has already detached from the pipe-holding grandchild.
      }
    })

    // then
    expect(result).toEqual({ kind: "unavailable", candidates })
    expect(Date.now() - startedAt).toBeLessThan(outerBoundMs)
    if (cleanupPid !== undefined) await probe
  })

  test("#given a failed child catalog probe #when candidates are preflighted #then it warns and preserves reactive fallback behavior", async () => {
    // given
    const item = await fixture('process.stderr.write("probe failed"); process.exit(7)')
    const warnings: string[] = []

    // when
    const result = await preflightMemoryModels({
      candidates,
      launch: item.launch,
      env: { PATH: process.env.PATH },
      configSources: [{ path: item.config, exists: true }],
      warn: (message, details) => warnings.push(`${message}: ${JSON.stringify(details)}`),
    })

    // then
    expect(result).toEqual({ kind: "unavailable", candidates })
    expect(warnings.join("\n")).toContain("exited with code 7")
  })

  test("#given a table catalog whose model column contains a slash #when candidates are preflighted #then the slashed model id stays visible", async () => {
    // given
    const item = await fixture(`process.stdout.write([
  "provider                    model                                                     context  max-out  thinking  images",
  "apitopia                    z-ai/glm-5.2-ultrafast-unlocked                           1M       131.1K   yes       no",
  "apitopia                    kimi-for-coding-highspeed                                 262.1K   65.5K    yes       yes",
].join("\\n") + "\\n")`)
    const slashed: MemoryModelChain = [
      { model: "apitopia/z-ai/glm-5.2-ultrafast-unlocked", thinking: "off" },
      { model: "apitopia/kimi-for-coding-highspeed" },
    ]

    // when
    const result = await preflightMemoryModels({
      candidates: slashed,
      launch: item.launch,
      env: { PATH: process.env.PATH },
      configSources: [{ path: item.config, exists: true }],
    })

    // then
    expect(result).toEqual({
      kind: "filtered",
      candidates: slashed,
      rejected: [],
    })
  })

  test("#given a table catalog row whose provider column contains a slash #when candidates are preflighted #then that malformed row is not treated as a visible model", async () => {
    // given
    const item = await fixture(`process.stdout.write([
  "provider                    model                                                     context",
  "bad/provider                some-model                                                1M",
  "apitopia                    z-ai/glm-5.2-ultrafast-unlocked                           1M",
].join("\\n") + "\\n")`)
    const mixed: MemoryModelChain = [
      { model: "bad/provider/some-model" },
      { model: "apitopia/z-ai/glm-5.2-ultrafast-unlocked" },
    ]

    // when
    const result = await preflightMemoryModels({
      candidates: mixed,
      launch: item.launch,
      env: { PATH: process.env.PATH },
      configSources: [{ path: item.config, exists: true }],
    })

    // then
    expect(result).toEqual({
      kind: "filtered",
      candidates: [{ model: "apitopia/z-ai/glm-5.2-ultrafast-unlocked" }],
      rejected: [{ model: "bad/provider/some-model", cause: "model_not_visible" }],
    })
  })

  test("#given a headerless catalog listing a slashed model id #when candidates are preflighted #then the slashed model id stays visible", async () => {
    // given
    const item = await fixture('process.stdout.write("apitopia/z-ai/glm-5.2-ultrafast-unlocked\\nbuiltin/fallback\\n")')
    const headerless: MemoryModelChain = [
      { model: "apitopia/z-ai/glm-5.2-ultrafast-unlocked" },
      { model: "builtin/fallback", thinking: "minimal" },
    ]

    // when
    const result = await preflightMemoryModels({
      candidates: headerless,
      launch: item.launch,
      env: { PATH: process.env.PATH },
      configSources: [{ path: item.config, exists: true }],
    })

    // then
    expect(result).toEqual({ kind: "filtered", candidates: headerless, rejected: [] })
  })

})
