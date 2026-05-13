import { existsSync } from "node:fs"
import { describe, expect, test } from "bun:test"

const DIST_INDEX = "dist/index.js"
const GLOBAL_BUN_DESTRUCTURE = /^\s*(?:var|let|const)\s*\{[^}]*\}\s*=\s*globalThis\.Bun/gm
const TOP_LEVEL_REQUIRE_CALL = "__require("

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
})
