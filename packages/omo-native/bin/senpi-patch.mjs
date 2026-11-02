import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { ensureBunBinShim } from "./lib/bun-bin-shim.js"
import { prepareInstalledEngine, preparePluginLaunchSpec, writeEnginePreparedStamp } from "./lib/engine-prepare.js"

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

// Prepare the package-owned entrypoint before a Bun-only machine's first launch (#9293).
// Bun owns the global bin symlinks; this restores only our legacy marked regular wrappers.
// It cannot undo a link error Bun recorded before postinstall began (#11019).
ensureBunBinShim({ scriptPath: join(packageRoot, "bin", "omo.js") })
const require = createRequire(join(packageRoot, "package.json"))
let senpiRoot = process.env.OMO_SENPI_PATCH_ROOT
try {
  if (senpiRoot === undefined) {
    const searchPaths = require.resolve.paths("@code-yeongyu/senpi") ?? []
    for (const searchPath of searchPaths) {
      const candidate = join(searchPath, "@code-yeongyu", "senpi")
      if (existsSync(join(candidate, "package.json"))) {
        senpiRoot = candidate
        break
      }
    }
    if (senpiRoot === undefined) throw new Error("package root not found in module graph")
  }
} catch (error) {
  throw new Error("omo-ai: unable to resolve the installed @code-yeongyu/senpi package", { cause: error })
}

preparePluginLaunchSpec({ pluginRoot: join(packageRoot, "plugin") })
prepareInstalledEngine(senpiRoot)
writeEnginePreparedStamp(senpiRoot, JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version)
