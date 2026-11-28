// Runs `omo setup`'s scan over a scratch home under whichever runtime starts it: the test runs it
// under Node for V8's parser text and under Bun for JavaScriptCore's. argv[2] is a JSON layout of
// [path relative to the home, file text] pairs. Prints one JSON value: each JSON file's own parse
// error in this runtime (the witness), every notice the scan produced, each stage's pending count,
// and the scan as the
// onboarding RPC carries it (source, items, notices, a failed source's reason). The home is removed
// before exiting.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { scanSetup } from "../bin/lib/setup-stream.js"

const layout = JSON.parse(process.argv[2])
const home = mkdtempSync(join(tmpdir(), "omo-read-failure-"))
try {
  const witnesses = {}
  for (const [path, text] of layout) {
    const file = join(home, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
    if (!path.endsWith(".json")) continue
    try {
      JSON.parse(text)
    } catch (error) {
      witnesses[path] = error.message
    }
  }
  const runtime = { home, env: { HOME: home }, loadModelCatalog: async () => [] }
  const results = []
  for await (const result of scanSetup(runtime, join(home, ".omo", "agent"), { includeCustomProviders: true }))
    results.push(result)
  const rpc = results.map(({ source, items, notices, error }) => ({ source, items, notices, reason: error?.message }))
  const runtimeName = typeof Bun === "undefined" ? "node" : "bun"
  // The detect stage keeps its notices per harness; `omo setup` prints them in its report.
  const harnessNotices = (result) => (result.source === "detect" ? result.plan.harnesses.flatMap((h) => h.notices) : [])
  const notices = results.flatMap((result) => [...harnessNotices(result), ...result.notices])
  const pending = Object.fromEntries(results.map((result) => [result.source, result.plan?.pending ?? 0]))
  process.stdout.write(JSON.stringify({ runtime: runtimeName, witnesses, notices, pending, rpc: JSON.stringify(rpc) }))
} finally {
  rmSync(home, { recursive: true, force: true })
}
