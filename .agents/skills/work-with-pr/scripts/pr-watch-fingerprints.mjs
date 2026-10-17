#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

import { buildBatches, decodeBatch } from "../../../../packages/omo-opencode/src/features/pr-watch/fingerprints.mjs"
export { buildBatches, decodeBatch, parsePullRequest } from "../../../../packages/omo-opencode/src/features/pr-watch/fingerprints.mjs"

export function runCli(argv) {
  const keys = []
  let previous = {}
  let previousPath
  let output
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--previous") {
      previousPath = argv[++index]
      if (previousPath === undefined) throw new Error("--previous requires a path")
      previous = JSON.parse(readFileSync(previousPath, "utf8"))
    }
    else if (argv[index] === "--output") {
      output = argv[++index]
      if (output === undefined) throw new Error("--output requires a path")
    }
    else keys.push(argv[index])
  }
  if (keys.length === 0) throw new Error("Usage: pr-watch-fingerprints.mjs [--previous acknowledged.json] [--output candidate.json] owner/repo#number ...")
  if (previousPath !== undefined && output !== undefined && (resolve(previousPath) === resolve(output)
    || (existsSync(output) && realpathSync(previousPath) === realpathSync(output)))) {
    throw new Error("Candidate output must not overwrite the acknowledged previous snapshot")
  }
  const now = Date.now()
  const batches = buildBatches(keys).map((batch) => {
    // No shell interpolation, REST rate_limit request, or token in command output.
    let stdout
    try {
      stdout = execFileSync("gh", ["api", "graphql", "-f", `query=${batch.query}`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
    } catch (error) {
      // gh exits nonzero for GraphQL errors even when stdout contains a valid error envelope.
      if (typeof error.stdout !== "string" || !error.stdout.trim().startsWith("{")) throw error
      stdout = error.stdout
    }
    return decodeBatch(batch, JSON.parse(stdout), previous, now)
  })
  const report = { version: 1, observedAt: now, batches }
  const json = `${JSON.stringify(report, null, 2)}\n`
  if (output !== undefined) writeFileSync(output, json, { mode: 0o600 })
  process.stdout.write(json)
  return batches.some(({ rows }) => rows.some(({ result }) => result !== "ok")) ? 2 : 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = runCli(process.argv.slice(2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
