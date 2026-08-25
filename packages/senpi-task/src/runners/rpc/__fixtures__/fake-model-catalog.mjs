import { existsSync, watch, writeFileSync } from "node:fs"
import { dirname } from "node:path"

const [pidPath, releasePath] = process.argv.slice(2)
if (pidPath === undefined || releasePath === undefined) {
  throw new Error("usage: fake-model-catalog.mjs <pid-path> <release-path>")
}

writeFileSync(pidPath, `${process.pid}\n`)
console.log("Provider Model")
console.log("omo-mock mock-1")

if (!existsSync(releasePath)) {
  await new Promise((resolve) => {
    const watcher = watch(dirname(releasePath), () => {
      if (!existsSync(releasePath)) return
      watcher.close()
      resolve()
    })
  })
}
