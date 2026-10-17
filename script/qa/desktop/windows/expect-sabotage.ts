// Asserts a sabotaged QA run failed the way it must: the JSONL line of `<scenario>` has
// `pass:false` and `reason` equal to `<reason>`.
//   bun script/qa/desktop/windows/expect-sabotage.ts <run.jsonl> <scenario> <reason>
import { readFileSync } from "node:fs"

import { asObject, type Json, type JsonObject } from "./engine"

const [file, scenario, reason] = process.argv.slice(2)
if (file === undefined || scenario === undefined || reason === undefined) {
  console.error("usage: expect-sabotage.ts <run.jsonl> <scenario> <reason>")
  process.exit(2)
}

function parseLine(line: string): JsonObject {
  const parsed: Json = JSON.parse(line)
  return asObject(parsed)
}

const entries = readFileSync(file, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map(parseLine)
const entry = entries.find((candidate) => candidate.scenario === scenario)
if (entry === undefined) {
  console.error(`sabotage: no '${scenario}' line in ${file}`)
  process.exit(1)
}
console.log(`sabotage: ${JSON.stringify({ scenario, pass: entry.pass ?? null, reason: entry.reason ?? null })}`)
if (entry.pass !== false || entry.reason !== reason) {
  console.error(`sabotage: expected ${scenario} pass:false reason ${reason}`)
  process.exit(1)
}
console.log(`sabotage: ok (${scenario} reported pass:false reason ${reason})`)
