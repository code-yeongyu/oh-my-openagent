import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const components = { "ulw-loop": join(dirname(fileURLToPath(import.meta.url)), "ulw-loop", "cli.js") }
const [component, ...args] = process.argv.slice(2)
const entry = components[component]
if (entry === undefined) {
  console.error(`Unknown component: ${component ?? "(missing)"}. Available components: ulw-loop`)
  process.exit(1)
}
const result = spawnSync(process.execPath, [entry, ...args], { stdio: "inherit" })
if (result.error !== undefined) throw result.error
process.exit(result.status ?? 1)
