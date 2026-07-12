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
