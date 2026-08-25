import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { appendFile, cp, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  buildExtension,
  checkExtensionCurrent,
  resolveBunExecutable,
  toPortableBuildPath,
} from "./build-extension.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(scriptDir, "..")
const repoRoot = join(scriptDir, "..", "..", "..", "..")
const perTestRoots = []
let sharedBuildPromise = null

setDefaultTimeout(30_000)

afterEach(async () => {
  await Promise.all(perTestRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

afterAll(async () => {
  if (sharedBuildPromise === null) return
  const shared = await sharedBuildPromise
  await rm(shared.root, { recursive: true, force: true })
})

function outputPathsIn(root) {
  return {
    outputPath: join(root, "omo.js"),
    taskOutputPath: join(root, "omo-task.js"),
    memberOutputPath: join(root, "omo-member.js"),
    memoryMcpOutputPath: join(root, "omo-memory-mcp.js"),
    supervisorOutputPath: join(root, "memory-run-supervisor.mjs"),
    advisorRuntimeOutputPath: join(root, "omo-init-deep-advisor.js"),
  }
}

/**
 * The esbuild pass dominates this file, so it runs once and every read-only assertion
 * shares it. Cases that mutate an artifact copy the built tree instead of rebuilding,
 * which keeps them isolated for a fraction of the cost.
 */
async function sharedOutputs() {
  sharedBuildPromise ??= (async () => {
    const root = await mkdtemp(join(repoRoot, ".build-extension-test-shared-"))
    const paths = outputPathsIn(root)
    const build = await buildExtension(paths)
    return { root, ...paths, ...build }
  })()
  return sharedBuildPromise
}

async function mutableOutputs() {
  const shared = await sharedOutputs()
  const root = await mkdtemp(join(repoRoot, ".build-extension-test-"))
  perTestRoots.push(root)
  await cp(shared.root, root, { recursive: true })
  return { root, ...outputPathsIn(root), mainInputs: shared.mainInputs, taskInputs: shared.taskInputs }
}

describe("checkExtensionCurrent", () => {
  test("#given the host platform #when resolving the Bun executable #then Windows bypasses the command shell", () => {
    expect(resolveBunExecutable("win32")).toBe("bun.exe")
    expect(resolveBunExecutable("darwin")).toBe("bun")
    expect(resolveBunExecutable("linux")).toBe("bun")
  })

  test("#given freshly built outputs #when the executable bundles are inspected #then the shebang stays the first bytes and the marker still parses", async () => {
    // given
    const outputs = await sharedOutputs()

    // when
    const mcp = await readFile(outputs.memoryMcpOutputPath, "utf8")
    const supervisor = await readFile(outputs.supervisorOutputPath, "utf8")

    // then (Node's ESM loader strips a shebang only at byte 0; a marker above it breaks startup)
    for (const text of [mcp, supervisor]) {
      expect(text.startsWith("#!/usr/bin/env node\n")).toBe(true)
      expect(text.indexOf("\n// omo:")).toBeGreaterThan(0)
    }
    // and the freshness round-trip still recognizes the artifacts
    const check = await checkExtensionCurrent({
      outputPath: outputs.outputPath,
      memberOutputPath: outputs.memberOutputPath,
      memoryMcpOutputPath: outputs.memoryMcpOutputPath,
      supervisorOutputPath: outputs.supervisorOutputPath,
    })
    expect(check.ok).toBe(true)
  })

  test("#given an empty output directory #when extensions are built #then all runtime personas match their sources", async () => {
    // given / when
    const outputs = await sharedOutputs()
    const personas = [
      ["reflection-persona.md", join(repoRoot, "packages", "memory-core", "src", "reflection", "assets", "reflection-persona.md")],
      ["dream-persona.md", join(repoRoot, "packages", "memory-core", "src", "reflection", "assets", "dream-persona.md")],
      ["facts-persona.md", join(repoRoot, "packages", "memory-core", "src", "facts", "assets", "facts-persona.md")],
    ]

    // then
    for (const [name, source] of personas) {
      expect(await readFile(join(dirname(outputs.outputPath), name), "utf8")).toBe(await readFile(source, "utf8"))
    }
  })

  test("#given platform-specific source paths #when normalized #then build markers use portable separators", () => {
    expect(toPortableBuildPath("packages\\omo-senpi\\src\\extension\\index.ts"))
      .toBe("packages/omo-senpi/src/extension/index.ts")
    expect(toPortableBuildPath("packages/omo-senpi/src/extension/index.ts"))
      .toBe("packages/omo-senpi/src/extension/index.ts")
  })

  test("#given current generated outputs with old mtimes #when checked #then freshness passes", async () => {
    // given
    const outputs = await mutableOutputs()
    const old = new Date(0)
    await Promise.all([
      utimes(outputs.outputPath, old, old),
      utimes(outputs.taskOutputPath, old, old),
      utimes(outputs.memberOutputPath, old, old),
    ])

    // when
    const result = await checkExtensionCurrent(outputs)

    // then
    expect(result).toMatchObject({ ok: true })
  })

  test("#given a missing supervisor artifact #when checked #then freshness reports that output", async () => {
    // given
    const outputs = await mutableOutputs()
    await rm(outputs.supervisorOutputPath)

    // when
    const result = await checkExtensionCurrent(outputs)

    // then
    expect(result).toMatchObject({ ok: false, reason: "missing-output", output: outputs.supervisorOutputPath })
  })

  test("#given a stale supervisor artifact #when checked #then freshness reports that output", async () => {
    // given
    const outputs = await mutableOutputs()
    await appendFile(outputs.supervisorOutputPath, "\nchanged\n")

    // when
    const result = await checkExtensionCurrent(outputs)

    // then
    expect(result).toMatchObject({ ok: false, reason: "stale-output", output: outputs.supervisorOutputPath })
  })

  test("#given changed generated bytes with future mtimes #when checked #then freshness fails", async () => {
    // given
    const outputs = await mutableOutputs()
    await appendFile(outputs.outputPath, "\nchanged\n")
    const future = new Date("2100-01-01T00:00:00.000Z")
    await utimes(outputs.outputPath, future, future)

    // when
    const result = await checkExtensionCurrent(outputs)

    // then
    expect(result).toMatchObject({ ok: false, reason: "stale-output", output: outputs.outputPath })
  })

  test("#given intact generated bytes with a stale source digest #when checked #then source reproduction fails", async () => {
    // given
    const outputs = await mutableOutputs()
    const artifact = await readFile(outputs.outputPath, "utf8")
    const newline = artifact.indexOf("\n")
    const [prefix, , bodyDigest] = artifact.slice(0, newline).split(":")
    await writeFile(outputs.outputPath, `${prefix}:${"0".repeat(43)}:${bodyDigest}\n${artifact.slice(newline + 1)}`)

    // when
    const result = await checkExtensionCurrent(outputs)

    // then
    expect(result).toMatchObject({ ok: false, reason: "stale-output", output: outputs.outputPath })
  })

  test("#given freshly built outputs #when inspected #then normalization removes whitespace-only lines", async () => {
    // given
    const outputs = await sharedOutputs()

    // when
    const main = await readFile(outputs.outputPath, "utf8")
    const task = await readFile(outputs.taskOutputPath, "utf8")
    const member = await readFile(outputs.memberOutputPath, "utf8")
    const advisorRuntime = await readFile(outputs.advisorRuntimeOutputPath, "utf8")

    // then
    expect(main).not.toMatch(/^[\t ]+$/m)
    expect(task).not.toMatch(/^[\t ]+$/m)
    expect(member).not.toMatch(/^[\t ]+$/m)
    expect(advisorRuntime).not.toMatch(/^[\t ]+$/m)
  })

  test("#given the split extension build #when metafile inputs are inspected #then task sources live only in the lazy sidecar", async () => {
    // given / when
    const { mainInputs, taskInputs } = await sharedOutputs()

    // then
    expect(mainInputs.some((input) => input.endsWith("packages/senpi-task/src/runners/in-process/curated-readonly-bash.ts")))
      .toBe(false)
    expect(taskInputs.some((input) => input.endsWith("packages/senpi-task/src/runners/in-process/curated-readonly-bash.ts")))
      .toBe(true)
  })

  test("#given a packaged task import map #when generated artifacts are inspected #then the main bundle resolves its task sidecar", async () => {
    const outputs = await sharedOutputs()
    const main = await readFile(outputs.outputPath, "utf8")
    const task = await readFile(outputs.taskOutputPath, "utf8")
    const manifest = JSON.parse(await readFile(join(pluginRoot, "package.json"), "utf8"))

    expect(main).toContain('import("#omo-task-runtime")')
    expect(task).toMatch(/^\/\/ omo:[A-Za-z0-9_-]{43}:[A-Za-z0-9_-]{43}/)
    expect(manifest.imports).toEqual({ "#omo-task-runtime": "./extensions/omo-task.js" })
  })
})
