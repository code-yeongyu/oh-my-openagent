import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runConfigMigrate } from "./packages/omo-opencode/src/cli/config-migrate"

const home = mkdtempSync(join(tmpdir(), "omo-e2e-"))
mkdirSync(join(home, ".omo"), { recursive: true })
const target = join(home, ".omo", "omo.jsonc")
writeFileSync(target, `${JSON.stringify({
  categories: {
    quick: { models: ["primary/model", "second/model"], fallback_models: ["legacy/fallback"] },
  },
}, null, 2)}\n`)

console.log("--- ~/.omo/omo.jsonc before ---")
console.log(readFileSync(target, "utf-8").trim())
console.log("--- oh-my-openagent config migrate ---")
const code = runConfigMigrate({ cwd: home, environment: { HOME: home }, output: (line) => console.log(line) })
console.log(`--- exit code ${code} ---`)
console.log("--- ~/.omo/omo.jsonc after ---")
console.log(readFileSync(target, "utf-8").trim())
