import { mkdirSync, rmSync, watch, writeFileSync } from "node:fs"
import { dirname } from "node:path"

const [statePath, readyPath, releasePath, snapshot] = process.argv.slice(2)
if (!statePath || !readyPath || !releasePath || !snapshot) throw new Error("missing legacy writer arguments")

mkdirSync(`${statePath}.lock`)
writeFileSync(statePath, "", "utf8")
const watcher = watch(dirname(releasePath), (_event, filename) => {
  if (filename !== releasePath.split(/[\\/]/).at(-1)) return
  watcher.close()
  writeFileSync(statePath, snapshot, "utf8")
  rmSync(`${statePath}.lock`, { recursive: true, force: true })
})
writeFileSync(readyPath, "ready\n", "utf8")
