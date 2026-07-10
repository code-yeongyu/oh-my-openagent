import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { resolveSpawnSyncInvocation } from "./check-third-party-notices.mjs"

const rootNotice = readFileSync(fileURLToPath(new URL("../THIRD-PARTY-NOTICES.md", import.meta.url)), "utf8")

test("#given root CodeGraph provisioning payload #when reading the third-party notice #then every CodeGraph package heading has the pinned version", () => {
  for (const name of [
    "@colbymchenry/codegraph",
    "@colbymchenry/codegraph-darwin-arm64",
    "@colbymchenry/codegraph-darwin-x64",
    "@colbymchenry/codegraph-linux-arm64",
    "@colbymchenry/codegraph-linux-x64",
    "@colbymchenry/codegraph-win32-arm64",
    "@colbymchenry/codegraph-win32-x64",
  ]) {
    assert.match(rootNotice, new RegExp(`^### ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@1\\.3\\.1$`, "m"))
  }
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
