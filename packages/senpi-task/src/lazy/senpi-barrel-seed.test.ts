/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// #12965: on Node the plugin's own import of the engine index evaluates a second engine copy next to the bundled
// CLI. The engine hands itself to an extension as `pi.engine`, and a barrel seeded from it must never import the
// index. Each case runs in a fresh Bun process whose loader replaces the engine index, because the barrel state is
// process-wide and cannot be reset in this process.

const BARREL = pathToFileURL(fileURLToPath(new URL("./senpi-barrel.ts", import.meta.url))).href
const INDEX_EVALUATED = "the engine index was evaluated"
const FORBIDDEN_INDEX = `throw new Error(${JSON.stringify(INDEX_EVALUATED)})`
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Runs `body` (which reads `barrel` and assigns `result`) in a fresh process whose engine index is `engineIndex`. */
function runWithEngineIndex(engineIndex: string, body: string): Record<string, unknown> {
  const root = mkdtempSync(join(tmpdir(), "senpi-barrel-seed-"))
  roots.push(root)
  const script = join(root, "seed.ts")
  writeFileSync(
    script,
    `Bun.plugin({
  setup(build) {
    build.onLoad({ filter: /@code-yeongyu[\\\\/]senpi[\\\\/]dist[\\\\/]index\\.js$/ }, () => ({ contents: ${JSON.stringify(engineIndex)}, loader: "js" }))
  },
})
const barrel = await import(${JSON.stringify(BARREL)})
let result
${body}
console.log(JSON.stringify(result))
`,
  )
  const child = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 20_000 })
  if (child.status !== 0) throw new Error(`seed script exited ${String(child.status)}: ${child.stderr}`)
  return JSON.parse(child.stdout) as Record<string, unknown>
}

describe("senpi barrel seeded from pi.engine", () => {
  it("#given an extension API that carries the engine #when the barrel is seeded from it #then loaders and readers get that engine and the engine index is never evaluated", () => {
    // when
    const out = runWithEngineIndex(
      FORBIDDEN_INDEX,
      `const engine = { createAgentSession: () => "seeded" }
barrel.seedSenpiBarrelFromExtensionApi({ engine })
const loaded = await barrel.loadSenpiBarrel()
result = { loadedIsEngine: loaded === engine, readerIsEngine: barrel.senpiBarrel() === engine }`,
    )

    // then
    expect(out).toEqual({ loadedIsEngine: true, readerIsEngine: true })
  }, 30_000)

  it("#given an extension API from an engine without pi.engine #when the barrel is seeded from it #then the barrel still imports the engine index", () => {
    // when
    const out = runWithEngineIndex(
      FORBIDDEN_INDEX,
      `barrel.seedSenpiBarrelFromExtensionApi({ registerTool() {} })
const failure = await barrel.loadSenpiBarrel().then(() => undefined, (error) => error)
result = { message: failure?.message }`,
    )

    // then
    expect(out).toEqual({ message: INDEX_EVALUATED })
  }, 30_000)

  it("#given a barrel that already imported the engine index #when it is seeded #then the seeded engine replaces the imported copy", () => {
    // when
    const out = runWithEngineIndex(
      `export const createAgentSession = () => "imported"`,
      `const imported = await barrel.loadSenpiBarrel()
const engine = { createAgentSession: () => "seeded" }
barrel.seedSenpiBarrel(engine)
result = { before: imported.createAgentSession(), after: (await barrel.loadSenpiBarrel()).createAgentSession(), reader: barrel.senpiBarrel().createAgentSession() }`,
    )

    // then
    expect(out).toEqual({ before: "imported", after: "seeded", reader: "seeded" })
  }, 30_000)

  it("#given host accessors already read from one engine #when the barrel is seeded with another #then the accessors read the new engine's exports", () => {
    // when
    const out = runWithEngineIndex(
      FORBIDDEN_INDEX,
      `const engineOf = (name) => ({ createAgentSession() {}, ensureHost: () => name })
barrel.seedSenpiBarrel(engineOf("first"))
const before = barrel.senpiEnsureHost()()
barrel.seedSenpiBarrel(engineOf("second"))
result = { before, after: barrel.senpiEnsureHost()() }`,
    )

    // then
    expect(out).toEqual({ before: "first", after: "second" })
  }, 30_000)
})
