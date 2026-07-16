import assert from "node:assert/strict"
import test from "node:test"

import { parseNpmPackJson, resolveSpawnSyncInvocation } from "./check-third-party-notices.mjs"

test("#given npm 11 pack JSON #when parsing the manifest #then preserves the legacy entry array", () => {
  const manifest = [{ files: [{ path: "legacy.txt" }] }]

  assert.deepEqual(parseNpmPackJson(JSON.stringify(manifest)), manifest)
})

test("#given npm 12 pack JSON #when parsing the manifest #then normalizes keyed package entries", () => {
  const entry = { files: [{ path: "keyed.txt" }] }

  assert.deepEqual(parseNpmPackJson(JSON.stringify({ "@scope/package": entry })), [entry])
})

test("#given mixed npm 12 pack entries #when parsing the manifest #then rejects the malformed payload", () => {
  const output = JSON.stringify({
    "@scope/valid": { files: [{ path: "valid.txt" }] },
    "@scope/invalid": { unexpected: true },
  })

  assert.throws(() => parseNpmPackJson(output), /did not produce a parseable file list/)
})

test("#given multiple valid npm 12 pack entries #when parsing the manifest #then rejects the ambiguous payload", () => {
  const output = JSON.stringify({
    decoy: { files: [{ path: "THIRD-PARTY-NOTICES.md" }] },
    "oh-my-opencode": { files: [] },
  })

  assert.throws(() => parseNpmPackJson(output), /did not produce a parseable file list/)
})

test("#given Windows npm command #when resolving notice checker spawn invocation #then uses cmd shim", () => {
  assert.deepEqual(resolveSpawnSyncInvocation("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], "win32"), {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", "npm.cmd", "pack", "--dry-run", "--json", "--ignore-scripts"],
  })
})

test("#given non-Windows npm command #when resolving notice checker spawn invocation #then preserves direct execution", () => {
  assert.deepEqual(resolveSpawnSyncInvocation("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], "linux"), {
    command: "npm",
    args: ["pack", "--dry-run", "--json", "--ignore-scripts"],
  })
})

test("#given Windows non-shim command #when resolving notice checker spawn invocation #then preserves direct execution", () => {
  assert.deepEqual(resolveSpawnSyncInvocation("node", ["--version"], "win32"), {
    command: "node",
    args: ["--version"],
  })
})
