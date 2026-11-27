// #10983: a setup notice about a file it could not read names the file and the operation, never the
// file's bytes. The scan runs in a child under Node, whose V8 parser error quotes the source around
// an unexpected token, and under Bun, whose JavaScriptCore error names the identifier; each run
// first proves its own parser error repeats the synthetic token. Synthetic values only; the driver's
// scratch home is removed before it exits.
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { applyModelChoices } from "../bin/lib/setup-model-choices-import.js"
import { scanSetup } from "../bin/lib/setup-stream.js"

const DRIVER = fileURLToPath(new URL("setup-read-failure.driver.mjs", import.meta.url))
const NODE = Bun.which("node")

type Scan = {
  runtime: string
  witnesses: Record<string, string>
  notices: string[]
  pending: Record<string, number>
  rpc: string
}

function scan(runtime: string, layout: Array<[string, string]>): Scan {
  const result = spawnSync(runtime, [DRIVER, JSON.stringify(layout)], { encoding: "utf8" })
  if (result.status !== 0) throw new Error(`driver exited ${result.status}: ${result.stderr}`)
  return JSON.parse(result.stdout) as Scan
}

/** The longest run of `token` (5 characters or more) that `text` repeats, 0 when none. */
function leaked(text: string, token: string): number {
  for (let size = token.length; size >= 5; size -= 1)
    for (let at = 0; at + size <= token.length; at += 1) if (text.includes(token.slice(at, at + size))) return size
  return 0
}

const OPENCODE_AUTH = ".local/share/opencode/auth.json"
const SENPI_AUTH = ".omo/agent/auth.json"
const SENPI_MODELS = ".omo/agent/models.json"
const OPENCODE_CONFIG = ".config/opencode/opencode.json"
const OMP_DB = ".omp/agent/agent.db"

// One bare (unquoted) synthetic value per file: the "unexpected token" shape both parsers quote.
const SHORT: Array<[string, string, string]> = [
  [OPENCODE_AUTH, "SYNTH-OCAUTH", '{"apiKey":SYNTH-OCAUTH}'],
  [SENPI_AUTH, "SYNTH-SENPIAUTH", '{"key":SYNTH-SENPIAUTH}'],
  [SENPI_MODELS, "SYNTH-MODELS", '{"providers":SYNTH-MODELS}'],
  [OPENCODE_CONFIG, "SYNTH-OCCONFIG", '{"mcp":SYNTH-OCCONFIG}'],
]
const SQLITE_TOKEN = "SYNTH-SQLITE"
// A long file: V8 quotes a window around the token, not the whole file.
const WINDOW_TOKEN = "sk-test-SYNTHETIC-WINDOW-0123456789"
const PAD = "x".repeat(4000)
const LONG = `{"a":"${PAD}","apiKey":${WINDOW_TOKEN},"b":"${PAD}"}`
const VALID_KEY = "sk-test-SYNTHETIC-VALID"

// CI and the release image install Node 24 beside Bun; a machine without node runs the Bun half.
const runtimes: Array<[string, string]> = [
  ...(NODE === null ? [] : [["node", NODE] satisfies [string, string]]),
  ["bun", process.execPath],
]

for (const [name, binary] of runtimes) {
  describe(`setup read failures under ${name}`, () => {
    test("#given malformed credential and config files #when setup scans #then no notice and no RPC row repeats their bytes", () => {
      const layout: Array<[string, string]> = SHORT.map(([path, , text]) => [path, text])
      layout.push([OMP_DB, `not a database ${SQLITE_TOKEN} `.repeat(40)])
      const result = scan(binary, layout)
      expect(result.runtime).toBe(name)
      const notices = result.notices.join("\n")
      for (const [path, token] of SHORT) expect(leaked(result.witnesses[path] ?? "", token)).toBeGreaterThan(0)
      // Every file in one assertion, so a failure lists each one that leaked and by how much.
      const rows = SHORT.map(([path, token]) => ({
        path,
        notices: leaked(notices, token),
        rpc: leaked(result.rpc, token),
      }))
      expect(rows).toEqual(SHORT.map(([path]) => ({ path, notices: 0, rpc: 0 })))
      expect(leaked(notices + result.rpc, SQLITE_TOKEN)).toBe(0)
      expect(result.notices).toContain("could not parse auth.json: not valid JSON")
      expect(result.notices).toContain("could not parse models.json: not valid JSON")
      expect(result.notices).toContain("WARN opencode: could not parse auth.json: not valid JSON")
      expect(
        result.notices.filter((notice) => notice.includes("could not inspect agent.db: SQLite: file is not a database"))
          .length,
      ).toBeGreaterThan(0)
      expect(
        result.notices.some(
          (notice) =>
            notice.startsWith(`WARN opencode: could not parse `) && notice.includes("opencode.json: not valid JSON;"),
        ),
      ).toBe(true)
    })

    test("#given a long credential file with a bare value #when setup scans #then the parser's quoted window stays out of every notice", () => {
      const result = scan(binary, [[OPENCODE_AUTH, LONG]])
      // Measured under V8: a window of about ten characters each side of the token, so a prefix of
      // the token is what a raw message would leak from a long file.
      if (name === "node") expect(leaked(result.witnesses[OPENCODE_AUTH] ?? "", WINDOW_TOKEN)).toBeGreaterThan(0)
      expect(leaked(result.notices.join("\n") + result.rpc, WINDOW_TOKEN)).toBe(0)
      expect(result.notices).toContain("WARN opencode: could not parse auth.json: not valid JSON")
    })

    test("#given a valid credential beside a malformed config #when setup scans #then the credential is still planned and its value never shown", () => {
      const auth = JSON.stringify({ openai: { type: "api", key: VALID_KEY } })
      const result = scan(binary, [
        [OPENCODE_AUTH, auth],
        [OPENCODE_CONFIG, '{"mcp":SYNTH-OCCONFIG}'],
      ])
      expect(result.pending.credentials).toBe(1)
      expect(result.notices.join("\n") + result.rpc).not.toContain(VALID_KEY)
      expect(leaked(result.notices.join("\n") + result.rpc, "SYNTH-OCCONFIG")).toBe(0)
    })
  })
}

// The model-choice stage, in process: its failures are not parser output from a sibling's file, so
// no runtime witness applies; each fault carries a synthetic token in its message instead.
describe("setup model-choice failures", () => {
  const CATALOG_TOKEN = "sk-test-SYNTHETIC-CATALOG"
  const WRITE_TOKEN = "SYNTH-WRITE"

  test("#given the engine's model list fails to load #when setup plans model choices #then the notice keeps only the failure kind", async () => {
    const home = mkdtempSync(join(tmpdir(), "omo-read-failure-"))
    try {
      mkdirSync(join(home, ".config", "opencode"), { recursive: true })
      writeFileSync(join(home, ".config", "opencode", "opencode.json"), JSON.stringify({ model: "openai/gpt-5" }))
      const loadModelCatalog = () => Promise.reject(new Error(`catalog failed near ${CATALOG_TOKEN}`))
      const notices: string[] = []
      for await (const result of scanSetup(
        { home, env: { HOME: home }, loadModelCatalog },
        join(home, ".omo", "agent"),
      ))
        if (result.source === "model-choices") notices.push(...result.notices)
      expect(notices).toContain(
        "WARN senpi: could not read the engine's model list (an unexpected error); model choices were not carried",
      )
      expect(leaked(notices.join("\n"), CATALOG_TOKEN)).toBe(0)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("#given a target the edit cannot reproduce #when model choices are applied #then the warning keeps only the failure kind", () => {
    const path = join(tmpdir(), "omo-read-failure-never-written.jsonc")
    const reports: string[] = []
    const target = { path, text: `{"a":${WRITE_TOKEN}}`, document: {} }
    const item = {
      state: "pending",
      label: "category demo",
      target,
      path: ["[senpi]", "categories"],
      members: [["demo", {}]],
    }
    applyModelChoices({ items: [item] }, { report: (line: string) => reports.push(line) })
    expect(reports).toEqual([
      `WARN senpi: could not edit ${path} safely (not valid JSON); these model choices were not written: category demo`,
    ])
  })
})
