import { rmSync } from "node:fs"

const buildCachePaths = [".next/cache/fetch-cache"]

for (const filePath of buildCachePaths) {
  rmSync(filePath, { force: true, recursive: true })
}
