import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { REQUIRED_PLUGIN_ARTIFACTS } from "../../src/install/plugin-artifacts.ts"
import { checkInstallCliCurrent } from "./build-install.mjs"
import { runtimeFileExternals } from "./build-extension-core.mjs"
import { staticSetPath } from "./omo-sdk-static-set.mjs"
import { RUNTIME_IMPORT_MAP, runtimeArtifactPaths, SDK_RUNTIME_FILES } from "./runtime-files.mjs"

// Slice P1c (#15031): the SDK root's runtime files are one declaration table. Every list that names a runtime file is
// derived from it, so a row added there reaches the build, the freshness check and the installer without a second
// hand-kept list (design lane ruling on the P1c plan).

const packageRoot = fileURLToPath(new URL("../..", import.meta.url))
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"))
const pluginManifest = readJson(join(packageRoot, "plugin", "package.json"))
const sourceManifest = readJson(join(packageRoot, "package.json"))

const row = (name) => SDK_RUNTIME_FILES.find((entry) => entry.name === name)

describe("the SDK runtime file table", () => {
  test("#given the table #then it has one root, and every row its own name, output, specifier, ceiling and kept list", () => {
    expect(SDK_RUNTIME_FILES.filter((entry) => !entry.lazy).map((entry) => entry.entry)).toEqual([
      "src/extension/omo-sdk.ts",
    ])
    for (const key of ["name", "output", "specifier", "staticSet"])
      expect(new Set(SDK_RUNTIME_FILES.map((entry) => entry[key])).size).toBe(SDK_RUNTIME_FILES.length)
    for (const entry of SDK_RUNTIME_FILES) {
      expect({ name: entry.name, ceiling: Number.isInteger(entry.ceiling) && entry.ceiling > 0 }).toEqual({
        name: entry.name,
        ceiling: true,
      })
      expect(readJson(staticSetPath(entry)).modules.length).toBeGreaterThan(0)
    }
  })

  test("#given every row #then the installer requires its output and both manifests map its specifier", () => {
    for (const entry of SDK_RUNTIME_FILES) {
      expect(REQUIRED_PLUGIN_ARTIFACTS).toContain(join(...entry.output.split("/")))
      expect(pluginManifest.imports[entry.specifier]).toBe(`./${entry.output}`)
      expect(pluginManifest.files.some((path) => entry.output.startsWith(`${path}/`))).toBe(true)
    }
    for (const entry of SDK_RUNTIME_FILES.filter((candidate) => candidate.lazy))
      expect(sourceManifest.imports[entry.specifier]).toBe(`./${entry.entry}`)
    expect(REQUIRED_PLUGIN_ARTIFACTS).toContain(RUNTIME_IMPORT_MAP)
  })

  test("#given a row added to the table #then the derived artifact paths and every row's externals carry it", () => {
    const added = {
      name: "probe",
      entry: "src/probe.ts",
      output: "runtime/omo-sdk/probe.js",
      specifier: "#omo-sdk-probe-runtime",
      lazy: true,
    }
    const table = [...SDK_RUNTIME_FILES, added]
    expect(runtimeArtifactPaths(table)).toContain(join("runtime", "omo-sdk", "probe.js"))
    for (const entry of table.filter((candidate) => candidate !== added))
      expect(runtimeFileExternals(entry, table)).toContain(added.specifier)
    expect(runtimeFileExternals(added, table)).not.toContain(added.specifier)
  })
})

// The installer is bundled self-contained, so it carries its own copy of this table (its required list); the committed
// copy is the one a fresh build writes, which holds the two tables byte-equal (the design lane's ruling on security
// review 6077124491: at 21a6cf8a43 the committed copy still said the root's old ceiling).
describe("the committed installer's copy of the table", () => {
  test("#given the committed plugin/scripts/install.mjs #then it is the fresh build of its sources", async () => {
    expect(await checkInstallCliCurrent()).toEqual({ current: true })
  })
})

describe("the boundary between the files carries data and functions only", () => {
  test("#given the thread file's entry module #then every export is a plain function or plain data (an object or the build stamp), never a class", async () => {
    const entry = await import("../../src/components/thread/sdk-core/runtime-entry.ts")
    expect(row("threads").entry).toBe("src/components/thread/sdk-core/runtime-entry.ts")
    for (const [name, value] of Object.entries(entry)) {
      const kind = typeof value
      expect({ name, kind: ["function", "object", "string"].includes(kind) ? "allowed" : kind }).toEqual({
        name,
        kind: "allowed",
      })
      if (kind === "function")
        expect({ name, isClass: /^class\b/.test(Function.prototype.toString.call(value)) }).toEqual({
          name,
          isClass: false,
        })
      if (kind === "object")
        expect({ name, prototype: Object.getPrototypeOf(value) === Object.prototype }).toEqual({
          name,
          prototype: true,
        })
    }
  })
})
