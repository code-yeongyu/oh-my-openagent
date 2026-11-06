import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { resolveSenpi } from "./package-paths.js"
import { omoPresenterAuthority } from "./service-auth.generated.js"

// The engine reads its presenter account authority from a process-global slot that only code run before its main()
// may fill, so omo registers it here, through the engine's own slot module, and then hands the process to the CLI.
const [cliPath, ...engineArgs] = process.argv.slice(2)
const engineRoot = resolveSenpi().packageRoot
// An engine without the slot export has no presenter account path at all; its hosts refuse every account presenter.
const exported = JSON.parse(readFileSync(join(engineRoot, "package.json"), "utf8")).exports?.["./presenter-authority"]?.import
if (typeof exported === "string") {
  const slot = await import(pathToFileURL(join(engineRoot, exported)).href)
  slot.registerPresenterAccountAuthority(omoPresenterAuthority(process.env))
}
process.argv.splice(1, process.argv.length - 1, cliPath, ...engineArgs)
await import(pathToFileURL(cliPath).href)
