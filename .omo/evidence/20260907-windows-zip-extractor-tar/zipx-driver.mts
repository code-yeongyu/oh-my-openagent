
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { extractZip } from "C:/Users/LilMG/Desktop/oh-my-openagent/packages/omo-opencode/src/shared/zip-extractor.ts"

const BSD = "C:\\Windows\\system32\\tar.exe"
const work = mkdtempSync(join(tmpdir(), "zipx-"))
mkdirSync(join(work, "payload"), { recursive: true })
writeFileSync(join(work, "payload", "rg.exe"), "binary-stub")
execFileSync(BSD, ["-a", "-c", "-f", "probe.zip", "payload"], { cwd: work })
const zip = join(work, "probe.zip")
const dest = join(work, "out")
mkdirSync(dest, { recursive: true })

console.log("bare 'tar' resolves to: " + execFileSync("tar", ["--version"], { encoding: "utf8" }).split("\n")[0])
try {
  await extractZip(zip, dest)
  console.log("RESULT: extractZip resolved | dest=" + JSON.stringify(readdirSync(dest)))
} catch (e) {
  console.log("RESULT: extractZip threw -> " + String(e && e.message ? e.message : e).split("\n")[0])
}
rmSync(work, { recursive: true, force: true })
