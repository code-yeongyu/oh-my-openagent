import { readFile, writeFile } from "node:fs/promises"

const mode = process.argv[2]
const payloadPath = process.env.FACTS_PAYLOAD_PATH
const extractionPath = process.env.FACTS_EXTRACTION_PATH
if (payloadPath === undefined || extractionPath === undefined) throw new Error("facts paths are required")
if (process.env.SENPI_MEMORY_FACTS !== "1") throw new Error("facts sentinel is required")

const payload = JSON.parse(await readFile(payloadPath, "utf8")) as {
  readonly today: string
  readonly entries: readonly unknown[]
}

if (mode === "fact") {
  await writeFile(extractionPath, `${JSON.stringify({
    scope: "project",
    text: `fixture consumed ${payload.entries.length} queue entries`,
    date: payload.today,
  })}\n`)
} else if (mode === "person") {
  await writeFile(extractionPath, `${JSON.stringify({
    scope: "person",
    person: { name: "Mina", aliases: ["Min"] },
    text: "Mina prefers concise reviews.",
    date: payload.today,
  })}\n`)
} else if (mode === "empty") {
  await writeFile(extractionPath, "")
} else if (mode === "malformed") {
  await writeFile(extractionPath, '{"scope":"project","person":{"name":"Mina","aliases":[]},"text":"bad","date":"2026-08-10"}\n')
} else if (mode === "fail") {
  process.exitCode = 7
} else if (mode === "model-not-found") {
  console.error('Error: Model "extension-only/primary" not found. Use --list-models to see available models.')
  process.exitCode = 1
} else {
  throw new Error(`unknown facts fixture mode: ${mode}`)
}
