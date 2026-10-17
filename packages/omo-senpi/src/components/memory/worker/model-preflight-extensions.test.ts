import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
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
  const root = await mkdtemp(join(tmpdir(), "memory-model-preflight-extensions-"))
  roots.push(root)
  const launcher = join(root, "fake-senpi.mjs")
  const config = join(root, "omo.jsonc")
  await writeFile(launcher, `${body}\n`, "utf8")
  await writeFile(config, "{}\n", "utf8")
  return { root, launch: { command: process.execPath, prefixArgs: [launcher] }, config }
}

describe("preflightMemoryModels extension routing (#9175)", () => {
  test("#given a candidate only an extension-loading child lists #when candidates are preflighted #then it keeps its place and is routed to load extensions", async () => {
    // given
    const item = await fixture(
      'process.stdout.write(process.argv.includes("--no-extensions") ? "builtin/fallback\\n" : "extension-only/primary\\nbuiltin/fallback\\n")',
    )

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
      candidates: [
        { model: "extension-only/primary", thinking: "off", loadExtensions: true },
        { model: "builtin/fallback", thinking: "minimal" },
      ],
      rejected: [],
    })
  })

  test("#given every candidate is in the discovery-disabled catalog #when candidates are preflighted #then no extension-loading catalog is probed", async () => {
    // given
    const item = await fixture(`
import { appendFileSync } from "node:fs"
appendFileSync(process.env.PROBE_LOG, process.argv.includes("--no-extensions") ? "core\\n" : "extensions\\n")
process.stdout.write("extension-only/primary\\nbuiltin/fallback\\n")
`)
    const probeLog = join(item.root, "probes.log")

    // when
    const result = await preflightMemoryModels({
      candidates,
      launch: item.launch,
      env: { PATH: process.env.PATH, PROBE_LOG: probeLog },
      configSources: [{ path: item.config, exists: true }],
    })

    // then
    expect(result).toEqual({ kind: "filtered", candidates, rejected: [] })
    expect(await Bun.file(probeLog).text()).toBe("core\n")
  })

  test("#given the extension-loading catalog probe fails #when a candidate is missing from the discovery-disabled catalog #then it warns and keeps the visible candidates only", async () => {
    // given
    const item = await fixture(
      'if (!process.argv.includes("--no-extensions")) { process.stderr.write("extension boom"); process.exit(3) }\nprocess.stdout.write("builtin/fallback\\n")',
    )
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
    expect(result).toEqual({
      kind: "filtered",
      candidates: [{ model: "builtin/fallback", thinking: "minimal" }],
      rejected: [{ model: "extension-only/primary", cause: "model_not_visible" }],
    })
    expect(warnings.join("\n")).toContain("exited with code 3")
  })
})
