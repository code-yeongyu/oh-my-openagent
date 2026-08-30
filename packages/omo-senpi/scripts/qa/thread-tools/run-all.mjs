#!/usr/bin/env bun
/**
 * Run every cross-surface thread-tool QA scenario in sequence and exit non-zero if any of
 * them fails. The scripts are run one at a time on purpose: each one owns a QA port and a
 * unix socket, and running them concurrently would make the port allocation the thing under
 * test instead of the thread tools.
 *
 * Usage: bun packages/omo-senpi/scripts/qa/thread-tools/run-all.mjs [--out-dir <dir>]
 */
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))

const scenarios = [
  ["cli-surface", "cli-surface.mjs"],
  ["desktop-client", "desktop-client.mjs"],
  ["terminal-to-ui", "terminal-to-ui.mjs"],
  ["desktop-to-cli", "desktop-to-cli.mjs"],
]

const outDirIndex = process.argv.indexOf("--out-dir")
const outDir = outDirIndex === -1 ? undefined : process.argv[outDirIndex + 1]
if (outDir !== undefined) mkdirSync(outDir, { recursive: true })

const results = []
for (const [name, file] of scenarios) {
  process.stdout.write(`\n===== ${name} =====\n`)
  const args = [process.execPath, join(here, file)]
  if (outDir !== undefined) args.push("--out", join(outDir, `${name}.txt`))
  const child = Bun.spawnSync(args, { stdout: "inherit", stderr: "inherit" })
  results.push({ name, code: child.exitCode })
  process.stdout.write(`----- ${name} exit=${child.exitCode} -----\n`)
}

process.stdout.write("\n===== summary =====\n")
for (const result of results) {
  process.stdout.write(`${result.code === 0 ? "PASS" : "FAIL"} ${result.name} exit=${result.code}\n`)
}
const failed = results.filter((result) => result.code !== 0)
process.stdout.write(`${failed.length === 0 ? "PASS" : "FAIL"} run-all failed_scenarios=${failed.length}\n`)
process.exit(failed.length === 0 ? 0 : 1)
