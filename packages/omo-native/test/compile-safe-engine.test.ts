import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { prepareCompileSafeEngine } from "../bin/lib/compile-safe-engine.js"

const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const PATCH_SCRIPT = join(PACKAGE_ROOT, "bin", "senpi-patch.mjs")
const CSS_TREE_VERSION = "3.2.1"
const PATCH_DATA = { atrules: { charset: { prelude: "<string>" } }, properties: { color: { syntax: "<color>" } } }
const AT_RULES = { "@media": { syntax: "@media <media-query-list> { <rule-list> }" } }
const PROPERTIES = { color: { syntax: "<color>" } }
const SYNTAXES = { color: { syntax: "<rgb()> | <hex-color>" } }

const roots: string[] = []

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

function createEngine(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-compile-safe-"))
  roots.push(root)
  write(join(root, "package.json"), JSON.stringify({ name: "@code-yeongyu/senpi", version: "2026.9.10", type: "module" }))
  const cssTree = join(root, "node_modules", "css-tree")
  write(join(cssTree, "package.json"), JSON.stringify({ name: "css-tree", version: CSS_TREE_VERSION, type: "module" }))
  write(join(cssTree, "data", "patch.json"), JSON.stringify(PATCH_DATA))
  write(
    join(cssTree, "lib", "data-patch.js"),
    "import { createRequire } from 'module';\n\nconst require = createRequire(import.meta.url);\nconst patch = require('../data/patch.json');\n\nexport default patch;\n",
  )
  write(
    join(cssTree, "cjs", "data-patch.cjs"),
    "'use strict';\n\nconst patch = require('../data/patch.json');\n\nconst patch$1 = patch;\n\nmodule.exports = patch$1;\n",
  )
  write(
    join(cssTree, "lib", "data.js"),
    "import { createRequire } from 'module';\nimport patch from './data-patch.js';\n\nconst require = createRequire(import.meta.url);\nconst mdnAtrules = require('mdn-data/css/at-rules.json');\nconst mdnProperties = require('mdn-data/css/properties.json');\nconst mdnSyntaxes = require('mdn-data/css/syntaxes.json');\n\nexport default { mdnAtrules, mdnProperties, mdnSyntaxes, patch };\n",
  )
  write(
    join(cssTree, "cjs", "data.cjs"),
    "'use strict';\n\nconst dataPatch = require('./data-patch.cjs');\n\nconst mdnAtrules = require('mdn-data/css/at-rules.json');\nconst mdnProperties = require('mdn-data/css/properties.json');\nconst mdnSyntaxes = require('mdn-data/css/syntaxes.json');\n\nmodule.exports = { mdnAtrules, mdnProperties, mdnSyntaxes, dataPatch };\n",
  )
  write(
    join(cssTree, "lib", "version.js"),
    "import { createRequire } from 'module';\n\nconst require = createRequire(import.meta.url);\n\nexport const { version } = require('../package.json');\n",
  )
  write(join(cssTree, "cjs", "version.cjs"), "'use strict';\n\nconst { version } = require('../package.json');\n\nexports.version = version;\n")
  const mdnCss = join(root, "node_modules", "mdn-data", "css")
  write(join(root, "node_modules", "mdn-data", "package.json"), JSON.stringify({ name: "mdn-data", version: "2.27.1" }))
  write(join(mdnCss, "at-rules.json"), JSON.stringify(AT_RULES))
  write(join(mdnCss, "properties.json"), JSON.stringify(PROPERTIES))
  write(join(mdnCss, "syntaxes.json"), JSON.stringify(SYNTAXES))
  return root
}

function cssTreeFile(root: string, ...segments: string[]): string {
  return readFileSync(join(root, "node_modules", "css-tree", ...segments), "utf8")
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("compile-safe engine preparation", () => {
  describe("#given an engine whose css-tree resolves its data through createRequire", () => {
    describe("#when the engine is prepared for bun compile", () => {
      test("#then no css-tree module reaches for a file at runtime", () => {
        const root = createEngine()
        prepareCompileSafeEngine(root)
        for (const relative of [
          ["lib", "data-patch.js"],
          ["cjs", "data-patch.cjs"],
          ["lib", "data.js"],
          ["cjs", "data.cjs"],
          ["lib", "version.js"],
          ["cjs", "version.cjs"],
        ]) {
          const source = cssTreeFile(root, ...relative)
          expect(source).not.toContain("require('../data/patch.json')")
          expect(source).not.toContain("require('mdn-data/css/at-rules.json')")
          expect(source).not.toContain("require('../package.json')")
        }
      })

      test("#then the inlined modules still expose the exact upstream data", async () => {
        const root = createEngine()
        prepareCompileSafeEngine(root)
        const cssTree = join(root, "node_modules", "css-tree")
        const dataPatch = await import(pathToFileURL(join(cssTree, "lib", "data-patch.js")).href)
        expect(dataPatch.default).toEqual(PATCH_DATA)
        const data = await import(pathToFileURL(join(cssTree, "lib", "data.js")).href)
        expect(data.default.mdnAtrules).toEqual(AT_RULES)
        expect(data.default.mdnProperties).toEqual(PROPERTIES)
        expect(data.default.mdnSyntaxes).toEqual(SYNTAXES)
        expect(data.default.patch).toEqual(PATCH_DATA)
        const version = await import(pathToFileURL(join(cssTree, "lib", "version.js")).href)
        expect(version.version).toBe(CSS_TREE_VERSION)
      })
    })

    describe("#when the preparation runs a second time", () => {
      test("#then every prepared file stays byte-identical", () => {
        const root = createEngine()
        prepareCompileSafeEngine(root)
        const first = cssTreeFile(root, "lib", "data.js")
        const firstPatch = cssTreeFile(root, "cjs", "data-patch.cjs")
        prepareCompileSafeEngine(root)
        expect(cssTreeFile(root, "lib", "data.js")).toBe(first)
        expect(cssTreeFile(root, "cjs", "data-patch.cjs")).toBe(firstPatch)
      })
    })
  })

  describe("#given a css-tree whose data module matches no known shape", () => {
    describe("#when the engine is prepared", () => {
      test("#then preparation fails loud instead of shipping a broken binary", () => {
        const root = createEngine()
        write(join(root, "node_modules", "css-tree", "lib", "data.js"), "export default {};\n")
        expect(() => prepareCompileSafeEngine(root)).toThrow("omo-ai: unsupported Senpi css-tree/lib/data.js")
      })
    })
  })

  describe("#given an engine that does not bundle css-tree", () => {
    describe("#when the engine is prepared", () => {
      test("#then preparation is a no-op", () => {
        const root = createEngine()
        rmSync(join(root, "node_modules", "css-tree"), { recursive: true, force: true })
        expect(() => prepareCompileSafeEngine(root)).not.toThrow()
      })
    })
  })

  describe("#given the patch script runs as postinstall does", () => {
    describe("#when the installed engine still resolves css-tree data dynamically", () => {
      test("#then the script prepares css-tree along with the pi-ai floor", () => {
        const root = createEngine()
        write(
          join(root, "node_modules", "@earendil-works", "pi-ai", "dist", "api", "anthropic-messages.js"),
          'const claudeCodeVersion = "2.1.251";\n',
        )
        const result = spawnSync("node", [PATCH_SCRIPT], {
          encoding: "utf8",
          env: { ...process.env, OMO_SENPI_PATCH_ROOT: root },
        })
        expect(result.stderr).toBe("")
        expect(result.status).toBe(0)
        expect(cssTreeFile(root, "lib", "data-patch.js")).not.toContain("createRequire")
      })
    })
  })
})
