import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// Builds must never bake or provision a shared ingest key. Consented clients register their own
// install-bound key at runtime; explicit keys remain a runtime environment override only.

const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url))
const BUILD_DIRS = [".github", "script"]
const BUILD_DEFINE_FILE = "packages/omo-senpi/plugin/scripts/build-extension-core.mjs"
const KEY = "OMO_TELEMETRY_INGEST_KEY"
const SELF = "script/telemetry-ingest-key-gate.test.ts"

/** Lines that give the key a value: `KEY: ...`, `KEY=...`, `env.KEY = ...` or `--define ...KEY...`. */
export function keyAssignments(text: string): string[] {
  return text.split("\n").filter((line) => {
    if (!line.includes(KEY)) return false
    return new RegExp(`${KEY}\\s*[:=]`).test(line) || /--define|--build-env/.test(line)
  })
}

async function filesUnder(dir: string): Promise<string[]> {
  const absolute = join(REPOSITORY_ROOT, dir)
  const entries = await readdir(absolute, { recursive: true, withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(REPOSITORY_ROOT.length).replace(/^\//, ""))
}

describe("telemetry ingest key gate", () => {
  test("#given a workflow that sets the key #then the scanner reports it", () => {
    expect(keyAssignments(`env:\n  ${KEY}: \${{ secrets.OMO_TELEMETRY_INGEST_KEY }}\n`)).toHaveLength(1)
    expect(keyAssignments(`run: ${KEY}=abc bun run build`)).toHaveLength(1)
    expect(keyAssignments(`# mentions ${KEY} in a comment only`)).toHaveLength(0)
  })

  test("#given the build workflows and scripts #when scanned #then none bakes or provisions the ingest key", async () => {
    const offenders: string[] = []
    for (const dir of BUILD_DIRS) {
      for (const file of await filesUnder(dir)) {
        if (file === SELF) continue
        const text = await readFile(join(REPOSITORY_ROOT, file), "utf8").catch(() => "")
        for (const line of keyAssignments(text)) offenders.push(`${file}: ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  test("#given the plugin build #then no ingest key define is supplied", async () => {
    const text = await readFile(join(REPOSITORY_ROOT, BUILD_DEFINE_FILE), "utf8")
    const keyLines = text.split("\n").filter((line) => line.includes(KEY)).map((line) => line.trim())
    expect(keyLines).toEqual([])
  })
})
