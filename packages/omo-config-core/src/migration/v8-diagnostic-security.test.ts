import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

test("V8 echoes the invalid value witness but journal and settings diagnostics never do", async () => {
  const root = mkdtempSync(join(tmpdir(), "v8-config-diagnostics-"))
  const secret = "sk-live-XY"
  const malformed = `{"apiKey":${secret}}`
  const runNode = (script: string, ...args: string[]) => execFileSync("node", ["--input-type=module", "-e", script, ...args], { encoding: "utf8", timeout: 20000 })
  try {
    const raw = runNode("try { JSON.parse(process.argv[1]) } catch (error) { console.log(error.message) }", malformed)
    expect(raw).toContain(secret)
    mkdirSync(join(root, ".omo"))
    writeFileSync(join(root, ".omo", ".migration-journal.json"), malformed)
    writeFileSync(join(root, "settings.json"), malformed)
    const built = await Bun.build({
      entrypoints: [fileURLToPath(new URL("./journal.ts", import.meta.url))],
      target: "node", outdir: root, naming: "journal.mjs",
    })
    expect(built.success).toBe(true)
    const journal = runNode(`
      const { readMigrationJournal } = await import(process.argv[1]);
      const fs = await import("node:fs");
      try { readMigrationJournal(fs, { HOME: process.argv[2] }) }
      catch (error) { console.log(error.message) }
    `, pathToFileURL(join(root, "journal.mjs")).href, root)
    expect(journal).toContain(".migration-journal.json")
    expect(journal).not.toContain(secret)
    const settings = runNode(`
      process.env.OMO_CODING_AGENT_DIR = process.argv[2];
      const { warningsForSettings } = await import(process.argv[1]);
      console.log(JSON.stringify(warningsForSettings()));
    `, new URL("../../../omo-native/bin/lib/doctor.js", import.meta.url).href, root)
    expect(settings).toContain("settings.json")
    expect(settings).not.toContain(secret)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
