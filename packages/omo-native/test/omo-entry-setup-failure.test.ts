// #10983 (review L3): `omo setup` reads other harnesses' credential files, so an error escaping it is
// printed as a fixed kind, never as the runtime's text; every other command keeps the entry's
// top-level `omo: <message>` line exactly. Each case runs the real entry (bin/omo.js) from a copy of
// bin/ in which one module it imports is replaced by one that throws an error carrying a synthetic
// token. The copy is removed after each test.
import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SOURCE_BIN = resolve(fileURLToPath(new URL("../bin", import.meta.url)))
const TOKEN = "sk-test-SYNTHETIC-entry"
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A copy of bin/ where `module` (under bin/lib) exports `name`, which throws `message`. */
function entryWithThrowing(module: string, name: string, message: string): { entry: string; home: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-entry-"))
  roots.push(root)
  cpSync(SOURCE_BIN, join(root, "bin"), { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "omo-ai", version: "1.2.3-test.0", type: "module" }))
  writeFileSync(
    join(root, "bin", "lib", module),
    `export async function ${name}() { throw new Error(${JSON.stringify(message)}) }\n`,
  )
  return { entry: join(root, "bin", "omo.js"), home: join(root, "home") }
}

function run(entry: string, home: string, args: string[]) {
  // OMO_RUNTIME=bun keeps the entry on the runtime the test already runs, with no re-exec.
  const env = { PATH: process.env.PATH ?? "", HOME: home, OMO_RUNTIME: "bun", TMPDIR: tmpdir() }
  return spawnSync(process.execPath, [entry, ...args], { encoding: "utf8", env })
}

describe("omo entry top-level errors", () => {
  test("#given setup throws an error quoting a file #when omo setup runs #then it prints the failure kind and exits 1", () => {
    const { entry, home } = entryWithThrowing("setup-import.js", "runSetup", `Unexpected token in "${TOKEN}"`)
    const result = run(entry, home, ["setup"])
    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 1,
      stderr: "omo setup: an unexpected error\n",
    })
  })

  test("#given another command throws #when it runs #then the entry prints its message exactly as before", () => {
    const message = `login failed near ${TOKEN}`
    const { entry, home } = entryWithThrowing("service-auth.generated.js", "runServiceAuthCommand", message)
    const result = run(entry, home, ["login"])
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 1, stderr: `omo: ${message}\n` })
  })
})
