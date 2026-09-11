import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { FileHookStateStorage } from "../../node_modules/@code-yeongyu/senpi/dist/core/extensions/builtin/hooks/trust-storage.js"

const root = mkdtempSync(join(tmpdir(), "omo-hooks-mode-"))
const cwd = join(root, "project")
const agentDir = join(root, "agent")
const statePath = join(cwd, ".senpi", "hooks-state.json")
mkdirSync(dirname(statePath), { recursive: true })
writeFileSync(statePath, '{"version":1,"hooks":{}}\n', "utf8")
chmodSync(statePath, 0o640)
const previousUmask = process.umask()
let mode: number
try {
  process.umask(0o077)
  new FileHookStateStorage({ cwd, agentDir }).update("project", (current) => current)
  mode = statSync(statePath).mode & 0o777
} finally {
  process.umask(previousUmask)
  rmSync(root, { recursive: true, force: true })
}
process.stdout.write(`${JSON.stringify({ mode })}\n`)
