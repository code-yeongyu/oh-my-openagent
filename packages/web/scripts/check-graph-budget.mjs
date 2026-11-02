import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { gzipSync } from "node:zlib"

const BUDGET_KB = 224
const BUDGET_BYTES = BUDGET_KB * 1024

const build = join(process.cwd(), ".next")
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? files(join(directory, entry.name)) : join(directory, entry.name),
      ),
    )
  ).flat()
}
const chunks = []
for (const file of await files(join(build, "static/chunks"))) {
  if (!file.endsWith(".js")) continue
  const content = await readFile(file)
  if (content.includes("WebGLRenderer"))
    chunks.push({
      file: relative(build, file),
      raw: content.length,
      gzip: gzipSync(content).length,
    })
}
process.stdout.write("file | raw KB | gzip KB\n")
for (const chunk of chunks)
  process.stdout.write(
    `${chunk.file} | ${(chunk.raw / 1024).toFixed(2)} | ${(chunk.gzip / 1024).toFixed(2)}\n`,
  )
const total = chunks.reduce((sum, chunk) => sum + chunk.gzip, 0)
process.stdout.write(`Total: ${(total / 1024).toFixed(2)} KB gzip / ${BUDGET_KB} KB\n`)
const manifestNames = (await readdir(build)).filter(
  (name) => name === "app-build-manifest.json" || name === "build-manifest.json",
)
if (!manifestNames.length) throw new Error("No Next build manifest found")
const initial = new Set()
for (const name of manifestNames) {
  const manifest = JSON.parse(await readFile(join(build, name), "utf8"))
  for (const [route, entries] of Object.entries(manifest.pages ?? {})) {
    if (["/", "/page", "/[locale]/page", "/layout", "/[locale]/layout", "/_app"].includes(route)) {
      for (const entry of entries) initial.add(entry)
    }
  }
  for (const entry of manifest.rootMainFiles ?? []) initial.add(entry)
}
const eager = chunks.filter((chunk) => initial.has(chunk.file))
if (!chunks.length || total > BUDGET_BYTES || eager.length) {
  console.error("Graph budget violation", {
    missingThreeChunk: !chunks.length,
    oversized: total > BUDGET_BYTES,
    eager,
  })
  process.exitCode = 1
} else
  process.stdout.write(
    "PASS: renderer chunks fit budget and are absent from the / initial page entries\n",
  )
