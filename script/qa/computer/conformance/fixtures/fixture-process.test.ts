import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FixtureProcess } from "./fixture-process.ts"

const PROFILE_KEYS = ["XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "CFFIXED_USER_HOME"] as const

const ENV_ECHO = `
const { writeFileSync } = require("node:fs")
const report = process.argv[process.argv.indexOf("--report") + 1]
const keys = ${JSON.stringify(PROFILE_KEYS)}
writeFileSync(report + ".env.json", JSON.stringify(Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null]))))
console.log("READY pid=" + process.pid)
process.stdin.on("data", (chunk) => { if (String(chunk).includes("quit")) process.exit(0) })
`

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("fixture process environment", () => {
  test("#given a fixture started by the driver #when it reads its profile locations #then every one is inside the run's own directory", async () => {
    const run = mkdtempSync(join(tmpdir(), "fixture-process-test-"))
    made.push(run)
    const script = join(run, "echo-env.cjs")
    writeFileSync(script, ENV_ECHO)
    const reportPath = join(run, "report.json")
    const fixture = await FixtureProcess.start([process.execPath, script], reportPath, "")
    await fixture.stop()
    const seen: Record<string, string | null> = JSON.parse(readFileSync(`${reportPath}.env.json`, "utf8"))
    for (const key of PROFILE_KEYS) {
      expect({ key, insideRun: seen[key]?.startsWith(run) ?? false }).toEqual({ key, insideRun: true })
    }
  }, 30_000)
})
