// Regenerates the engine's telemetry schema artifacts and the docs schema block from the event schemas:
//   bun packages/omo-senpi/scripts/telemetry-schema-artifact.ts           # write
//   bun packages/omo-senpi/scripts/telemetry-schema-artifact.ts --check   # exit 1 on drift
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { generateTelemetrySchemaBlock } from "../../../script/telemetry-schema-block.mjs"
import {
  artifactFileName,
  buildTelemetryArtifacts,
  serializeArtifact,
} from "../src/components/telemetry/telemetry-artifact"

const TELEMETRY_DIR = new URL("../src/components/telemetry/", import.meta.url)
// The published plugin package ships the same files (plugin/package.json "files").
const PLUGIN_DIR = new URL("../plugin/", import.meta.url)
const DOC_URL = new URL("../../../docs/reference/senpi-telemetry.md", import.meta.url)
const BEGIN = "<!-- BEGIN GENERATED SCHEMA -->"
const END = "<!-- END GENERATED SCHEMA -->"

function withDocBlock(document: string, block: string): string {
  const begin = document.indexOf(BEGIN)
  const end = document.indexOf(END)
  if (begin < 0 || end < begin) throw new Error("docs/reference/senpi-telemetry.md has no generated schema block")
  return document.slice(0, begin) + block + document.slice(end + END.length)
}

const check = process.argv.includes("--check")
const outputs: [URL, string][] = buildTelemetryArtifacts().flatMap((artifact): [URL, string][] => [
  [new URL(artifactFileName(artifact.product), TELEMETRY_DIR), serializeArtifact(artifact)],
  [new URL(artifactFileName(artifact.product), PLUGIN_DIR), serializeArtifact(artifact)],
])
outputs.push([DOC_URL, withDocBlock(readFileSync(DOC_URL, "utf8"), generateTelemetrySchemaBlock())])

let drifted = 0
for (const [url, content] of outputs) {
  const path = fileURLToPath(url)
  let current: string | undefined
  try {
    current = readFileSync(path, "utf8")
  } catch {
    current = undefined
  }
  if (current === content) continue
  drifted += 1
  if (check) console.error(`drift: ${path}`)
  else {
    writeFileSync(path, content)
    console.log(`wrote ${path}`)
  }
}
if (check && drifted > 0) process.exit(1)
if (drifted === 0) console.log("telemetry schema artifacts and docs are up to date")
