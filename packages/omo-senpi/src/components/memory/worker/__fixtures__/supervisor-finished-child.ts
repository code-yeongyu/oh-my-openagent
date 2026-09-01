import { writeFile } from "node:fs/promises"
import { join } from "node:path"

const runDir = process.argv[2]
if (runDir === undefined) throw new TypeError("run directory is required")

await writeFile(join(runDir, "child-finished.json"), `${JSON.stringify({ finished: true })}\n`, "utf8")
