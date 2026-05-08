import { rmSync } from "node:fs"
import { execSync } from "node:child_process"

const buildCachePaths = [".next/cache/fetch-cache"]

for (const filePath of buildCachePaths) {
  rmSync(filePath, { force: true, recursive: true })
}

execSync("node ./scripts/generate-docs-content.mjs", { stdio: "inherit" })
