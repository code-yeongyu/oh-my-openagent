import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { basename, join, relative } from "node:path"

import { senpiPackageVersion } from "../senpi-test-runtime"
import { absentSenpiSeams, SENPI_SEAMS } from "./senpi-seams"
import { loadWithPinnedSenpi, withSeamEdit } from "./senpi-seams.test-support"

const SRC_ROOT = join(import.meta.dir, "..")
const SEAM_LIST_FILE = join(import.meta.dir, "senpi-seams.ts")

const GUARD_PATTERNS: readonly { readonly pattern: RegExp; readonly seam: (match: RegExpExecArray) => string }[] = [
  { pattern: /(?<![\w$])(?:pi|api)\.(\w+)\?\.([A-Za-z_$][\w$]*)/g, seam: (match) => `${match[1]}.${match[2]}` },
  { pattern: /(?<![\w$])(?:pi|api)\.(\w+)\?\./g, seam: (match) => match[1] ?? "" },
  { pattern: /typeof\s+(?:[\w$]+\.)*(?:pi|api)\.(\w+)/g, seam: (match) => match[1] ?? "" },
  { pattern: /(?<![\w$])(?:pi|api)\.(\w+)\s*[!=]==?\s*undefined/g, seam: (match) => match[1] ?? "" },
  { pattern: /["'](\w+)["']\s+in\s+(?:pi|api)(?![\w$.])/g, seam: (match) => match[1] ?? "" },
  { pattern: /(?<![\w$])(?:pi|api)\.(\w+)\s*(?:\?\?|&&|\|\||\?(?![.?]))/g, seam: (match) => match[1] ?? "" },
  { pattern: /!\s*(?:pi|api)\.(\w+)(?![\w$(.?])/g, seam: (match) => match[1] ?? "" },
  { pattern: /\bif\s*\(\s*(?:pi|api)\.(\w+)\s*\)/g, seam: (match) => match[1] ?? "" },
]

function guardedSeams(source: string): Set<string> {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
  const seams = new Set<string>()
  for (const { pattern, seam } of GUARD_PATTERNS) {
    for (const match of code.matchAll(pattern)) seams.add(seam(match))
  }
  return seams
}

function isTestOnly(file: string): boolean {
  return /(^|[.-])(test|fixture|test-support|test-harness)([.-]|$)/.test(basename(file, ".ts"))
}

function productionSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "__fixtures__" ? [] : productionSources(path)
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") && !isTestOnly(entry.name) && path !== SEAM_LIST_FILE ? [path] : []
  })
}

async function pinnedExtensionApi(): Promise<object> {
  let captured: object | undefined
  await loadWithPinnedSenpi(SRC_ROOT, (pi) => { captured = pi })
  if (captured === undefined) throw new Error("senpi never ran the extension factory")
  return captured
}

describe("senpi seam contract", () => {
  test("#given every production guard site #when scanned #then each guarded seam is listed in SENPI_SEAMS and nothing else is", () => {
    // given
    const sites = new Map<string, string[]>()
    for (const file of productionSources(SRC_ROOT)) {
      for (const seam of guardedSeams(readFileSync(file, "utf8"))) sites.set(seam, [...(sites.get(seam) ?? []), relative(SRC_ROOT, file)])
    }
    const listed = new Set(Object.keys(SENPI_SEAMS))

    // when
    const unlisted = [...sites.keys()].filter((seam) => !listed.has(seam)).map((seam) => `${seam} (${(sites.get(seam) ?? []).join(", ")})`)
    const unguarded = [...listed].filter((seam) => !sites.has(seam))

    // then
    expect({ unlisted, unguarded }).toEqual({ unlisted: [], unguarded: [] })
  })

  test("#given a new guard on a seam #when the scanner reads it #then it reports that seam", () => {
    // given
    const source = [
      "if (typeof pi.registerRpcRemoteSource !== \"function\") return false",
      "const host = deps.pi.lifecycle?.markRunCompleted",
      "if (\"getWidgets\" in pi) pi.getWidgets()",
      "// typeof pi.commentedOut",
      "const version = options.version ?? pi.hostVersion ?? \"unknown\"",
      "if (pi.getTheme) pi.getTheme()",
      "const status = api.setStatus && api.setStatus(\"x\")",
      "if (!pi.setTitle) return",
      "const id = pi.sessionId || fallbackId",
      "const label = pi.sessionLabel ? pi.sessionLabel : \"none\"",
      "const n = pi.registerTool(tool) ?? pi.on(\"x\", handler) && pi.cwd",
    ].join("\n")

    // when
    const seams = guardedSeams(source)

    // then
    expect([...seams].sort()).toEqual(["getTheme", "getWidgets", "hostVersion", "lifecycle", "lifecycle.markRunCompleted", "registerRpcRemoteSource", "sessionId", "sessionLabel", "setStatus", "setTitle"])
  })

  test("#given the installed senpi #when compared with the package pin #then it is the pinned version", () => {
    // given
    const manifest = JSON.parse(readFileSync(join(SRC_ROOT, "..", "package.json"), "utf8")) as { devDependencies?: Record<string, string> }

    // when
    const pinned = manifest.devDependencies?.["@code-yeongyu/senpi"]

    // then
    expect(senpiPackageVersion).toBe(pinned)
  })

  test("#given the pinned senpi's real ExtensionAPI #when every listed seam is checked #then none is absent", async () => {
    // given
    const pi = await pinnedExtensionApi()

    // when
    const absent = absentSenpiSeams(pi)

    // then
    expect(absent).toEqual([])
  })

  test("#given the pinned ExtensionAPI with seams removed #when checked #then exactly those seams are reported absent", async () => {
    // given
    const pi = withSeamEdit(await pinnedExtensionApi(), { hide: ["registerReadClassifier", "rpc.handle", "sessionContext"] })

    // when
    const absent = absentSenpiSeams(pi)

    // then
    expect(absent).toEqual(["registerReadClassifier", "rpc.handle", "sessionContext"])
  })

  test("#given a seam with the wrong type #when checked #then it is reported absent", () => {
    // given
    const surface = { cwd: 42, rpc: { emit: () => undefined, handle: "not a function" } }

    // when
    const absent = absentSenpiSeams(surface, { cwd: "string", rpc: "object", "rpc.emit": "function", "rpc.handle": "function" })

    // then
    expect(absent).toEqual(["cwd", "rpc.handle"])
  })
})
