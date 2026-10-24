import { afterEach, expect, test } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { DORI_TOOLKIT_ENV, DORI_TOOLKIT_NAMESPACES } from "./dori-gate"

// Package contract: the shipped plugin keeps every dori layer in its own sidecar under runtime/dori,
// loaded by URL only while the gate is on, so a run with the section off evaluates none of it.
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../plugin")
const builtSdk = join(pluginRoot, "runtime", "agent-toolkit-sdk", "sdk.js")
const builtLayer = join(pluginRoot, "runtime", "dori", "layer2.js")
const builtReplay = join(pluginRoot, "runtime", "dori", "replay.js")
const builtExtension = join(pluginRoot, "extensions", "omo.js")

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function stagedRuntime(withLayer: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "dori-shipped-"))
  directories.push(root)
  const sdk = join(root, "runtime", "agent-toolkit-sdk", "sdk.js")
  mkdirSync(dirname(sdk), { recursive: true })
  copyFileSync(builtSdk, sdk)
  if (withLayer) {
    mkdirSync(join(root, "runtime", "dori"), { recursive: true })
    copyFileSync(builtLayer, join(root, "runtime", "dori", "layer2.js"))
  }
  return sdk
}

async function importKeys(sdk: string, gate: string | undefined): Promise<{ readonly code: number; readonly keys: readonly string[]; readonly stderr: string }> {
  const child = Bun.spawn([process.execPath, "-e", `const { agentToolkit } = await import(${JSON.stringify(sdk)}); console.log(JSON.stringify(Object.keys(agentToolkit)))`], {
    env: { ...process.env, [DORI_TOOLKIT_ENV]: gate },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { code, keys: code === 0 ? (JSON.parse(stdout.trim()) as string[]) : [], stderr }
}

test("#given the shipped SDK without its dori sidecar #when it is imported with the gate off #then it loads with no namespace, and only the gate on reaches for the sidecar", async () => {
  const bare = stagedRuntime(false)
  const off = await importKeys(bare, undefined)
  expect(off.code).toBe(0)
  for (const namespace of DORI_TOOLKIT_NAMESPACES) expect(off.keys).not.toContain(namespace)
  const on = await importKeys(bare, "1")
  expect(on.code).not.toBe(0)
  for (const stderr of [on.stderr.replaceAll("\\", "/"), on.stderr.replaceAll("/", "\\")]) {
    expect(stderr.replaceAll("\\", "/")).toContain("dori/layer2.js")
  }
}, 30_000)

test("#given the shipped SDK with its dori sidecar #when it is imported with the gate on #then the namespaces come from the sidecar", async () => {
  const on = await importKeys(stagedRuntime(true), "1")
  expect(on.code).toBe(0)
  for (const namespace of DORI_TOOLKIT_NAMESPACES) expect(on.keys).toContain(namespace)
}, 30_000)

test("#given the shipped extension #when its bundles are read #then the replay journal lives only in the runtime/dori sidecar", () => {
  expect(readFileSync(builtExtension, "utf8")).not.toContain("replay_differs=")
  expect(readFileSync(builtExtension, "utf8")).not.toContain("ToolkitReplayStopError")
  expect(readFileSync(builtSdk, "utf8")).not.toContain("ToolkitReplayStopError")
  expect(readFileSync(builtReplay, "utf8")).toContain("replay_differs=")
  expect(readFileSync(builtLayer, "utf8")).toContain("ToolkitReplayStopError")
})
