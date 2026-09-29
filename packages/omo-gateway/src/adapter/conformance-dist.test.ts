import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BUNDLE_FILE, type ConformanceManifest, bareImports, bundleConformance } from "../../scripts/build-conformance"

let outDir = ""
let manifest: ConformanceManifest
let bundlePath = ""

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), "omo-gateway-conformance-dist-"))
  ;({ manifest, bundlePath } = await bundleConformance(outDir))
})

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true })
})

describe("standalone conformance distribution", () => {
  test("the manifest exports ./conformance at the bundle and declares no dependencies", async () => {
    const written: unknown = JSON.parse(await readFile(join(outDir, "package.json"), "utf8"))
    expect(written).toEqual(manifest)
    expect(manifest.name).toBe("@oh-my-opencode/omo-gateway")
    expect(manifest.exports["./conformance"].import).toBe(`./${BUNDLE_FILE}`)
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) expect(Object.hasOwn(manifest, field)).toBe(false)
  })

  test("the bundle has no import that needs an installed package", async () => {
    expect(bareImports(await readFile(bundlePath, "utf8"))).toEqual([])
  })

  test("the built bundle passes the conformance suite against its own fake adapter", async () => {
    const built: typeof import("./conformance") = await import(bundlePath)
    const platform = new built.FakePlatform({ platform: "feishu", account_id: "T000TEST" })
    const report = await built.runAdapterConformance(() => new built.FakeAdapter({ platform }), platform.fixtures())
    expect(report.checks.filter((check) => check.status !== "pass")).toEqual([])
    expect(report.checks.map((check) => check.id)).toEqual([...built.CONFORMANCE_CHECKS])
  })
})

test("bareImports flags package specifiers and ignores relative, absolute and node: ones", () => {
  const code = [
    'import { a } from "./local.js"',
    'import b from "../up.js"',
    'import "/abs/path.js"',
    'import { c } from "node:fs"',
    'export { d } from "@oh-my-opencode/memory-core"',
    'const e = await import("zod")',
    'const f = require("left-pad")',
  ].join("\n")
  expect(bareImports(code)).toEqual(["@oh-my-opencode/memory-core", "zod", "left-pad"])
})
