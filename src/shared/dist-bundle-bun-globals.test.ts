/// <reference types="bun-types" />

import { existsSync } from "node:fs"
import { describe, expect, test } from "bun:test"

const DIST_INDEX = "dist/index.js"
const GLOBAL_BUN_DESTRUCTURE = /^\s*(?:var|let|const)\s*\{[^}]*\}\s*=\s*globalThis\.Bun/gm
const TOP_LEVEL_REQUIRE_CALL = "__require("
const RAW_BUN_API_CALL = /(?<![.$\w])Bun\.[a-zA-Z_$][a-zA-Z_$0-9]*\s*[.(]/g
const NODE_EXPORT_SMOKE_SCRIPT = [
  "const mod = await import('./dist/index.js');",
  "const keys = Object.keys(mod).join(',');",
  "console.log('SMOKE_OK:' + keys);",
].join("\n")

function hasRawBunApiCall(line: string): boolean {
  RAW_BUN_API_CALL.lastIndex = 0
  return RAW_BUN_API_CALL.test(line)
}

function isInsideStringLiteral(line: string, position: number): boolean {
  let quote: "'" | '"' | "`" | null = null
  let escaped = false

  for (let index = 0; index < position; index += 1) {
    const char = line.charAt(index)

    if (escaped) {
      escaped = false
      continue
    }

    if (quote !== null && char === "\\") {
      escaped = true
      continue
    }

    if (char === "'" || char === '"' || char === "`") {
      if (quote === char) {
        quote = null
      } else if (quote === null) {
        quote = char
      }
    }
  }

  return quote !== null
}

function formatOffendingLine(lineNumber: number, line: string): string {
  const content = line.trim()
  const truncated = content.length > 120 ? `${content.slice(0, 117)}...` : content

  return `${lineNumber}: ${truncated}`
}

describe("dist bundle Bun globals", () => {
  test.skipIf(!existsSync(DIST_INDEX))("#given dist bundle #when scanned #then no globalThis.Bun destructures remain", async () => {
    const dist = await Bun.file(DIST_INDEX).text()

    const matches = dist.match(GLOBAL_BUN_DESTRUCTURE) ?? []

    expect(matches).toEqual([])
  })

  test.skipIf(!existsSync(DIST_INDEX))("#given dist bundle #when scanned #then no top-level __require call remains", async () => {
    const dist = await Bun.file(DIST_INDEX).text()
    const offending: string[] = []
    let depth = 0

    for (const [index, line] of dist.split("\n").entries()) {
      if (depth === 0 && line.includes(TOP_LEVEL_REQUIRE_CALL)) {
        offending.push(`${index + 1}: ${line.trim()}`)
      }

      for (const char of line) {
        if (char === "{") {
          depth += 1
        } else if (char === "}") {
          depth -= 1
          if (depth < 0) depth = 0
        }
      }
    }

    expect(offending).toEqual([])
  })

  test.skipIf(!existsSync(DIST_INDEX))("#given dist bundle #when imported under node --input-type=module #then it loads without error", async () => {
    const node = Bun.which("node")
    if (!node) return

    const proc = Bun.spawn({
      cmd: [node, "--input-type=module", "-e", "await import('./dist/index.js'); console.log('node-esm-load-ok')"],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    expect({
      exitCode,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    }).toEqual({
      exitCode: 0,
      stdout: "node-esm-load-ok",
      stderr: "",
    })
  })

  test.skipIf(!existsSync(DIST_INDEX))("#given dist bundle #when scanned for raw Bun runtime APIs #then no unshimmed Bun API calls remain", async () => {
    expect(hasRawBunApiCall("Bun.file('dist/index.js')")).toBe(true)
    expect(hasRawBunApiCall("runtime.Bun.file('dist/index.js')")).toBe(false)
    expect(hasRawBunApiCall(".Bun.file('dist/index.js')")).toBe(false)
    expect(hasRawBunApiCall("$Bun.file('dist/index.js')")).toBe(false)
    expect(hasRawBunApiCall("Bun.spawnSync.options")).toBe(true)
    expect(hasRawBunApiCall("Bun.readableStreamToText(stream)")).toBe(true)

    const dist = await Bun.file(DIST_INDEX).text()
    const offending: string[] = []
    let insideJSDoc = false

    for (const [index, line] of dist.split("\n").entries()) {
      const trimmed = line.trimStart()

      if (insideJSDoc || trimmed.startsWith("/**")) {
        insideJSDoc = !trimmed.includes("*/")
        continue
      }

      if (line.includes("runtime.Bun") || line.includes("globalThis.Bun") || line.includes("typeof Bun")) {
        continue
      }

      RAW_BUN_API_CALL.lastIndex = 0
      const rawMatch = [...line.matchAll(RAW_BUN_API_CALL)].find(
        (match) => match.index !== undefined && !isInsideStringLiteral(line, match.index),
      )

      if (rawMatch) {
        offending.push(formatOffendingLine(index + 1, line))
      }
    }

    expect(
      offending,
      `Expected zero raw Bun API calls in dist/index.js but found ${offending.length}:\n${offending.join("\n")}`,
    ).toEqual([])
  })

  test.skipIf(!existsSync(DIST_INDEX))("#given dist bundle #when imported and inspected under node --input-type=module #then stderr has no Bun reference errors", async () => {
    const node = Bun.which("node")
    if (!node) return

    const proc = Bun.spawn({
      cmd: [node, "--input-type=module", "-e", NODE_EXPORT_SMOKE_SCRIPT],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited
    const stderrLower = stderr.toLowerCase()

    expect(exitCode, stderr.trim()).toBe(0)
    expect(stdout).toContain("SMOKE_OK:")
    expect(stderrLower).not.toContain("referenceerror")
    expect(stderr).not.toContain("Bun is not defined")
  })
})
