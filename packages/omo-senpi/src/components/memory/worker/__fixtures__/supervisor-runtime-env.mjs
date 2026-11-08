import { writeFileSync } from "node:fs"
import { join } from "node:path"

writeFileSync(join(process.argv[2], "runtime-mode"), process.env.BUN_BE_BUN ?? "unset")
