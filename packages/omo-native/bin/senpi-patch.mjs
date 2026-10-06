import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { ensureBunBinShim } from "./lib/bun-bin-shim.js"
import { prepareInstalledEngine, preparePluginLaunchSpec, writeEnginePreparedStamp } from "./lib/engine-prepare.js"

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

// `bun add -g` has just linked the bin back to omo.js, whose `#!/usr/bin/env node` cannot start
// where node is not on PATH; this postinstall runs right after that link (on bun when node is
// missing), so it restores the bun launcher shim before anything launches `omo` (#9293). Quiet and
// fail-open, and a no-op outside a POSIX bun-global install, so it runs before the engine work.
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
