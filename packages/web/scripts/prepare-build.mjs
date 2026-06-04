import { rmSync } from "node:fs"
import { execSync } from "node:child_process"

const buildCachePaths = [".next/cache/fetch-cache"]
const shouldClearFetchCache = process.env.OMO_WEB_CLEAR_FETCH_CACHE === "1"

if (shouldClearFetchCache) {
  for (const filePath of buildCachePaths) {
    rmSync(filePath, { force: true, recursive: true })
  }
}

execSync("node ./scripts/generate-docs-content.mjs", { stdio: "inherit" })
