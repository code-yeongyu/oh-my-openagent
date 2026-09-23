import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { prepareInstalledEngine, writeEnginePreparedStamp } from "./lib/engine-prepare.js"

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
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

prepareInstalledEngine(senpiRoot)
writeEnginePreparedStamp(senpiRoot, JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version)
