import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { findModuleHostingWorkspace } from "./module-hosting-workspace"

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function workspaceDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-hosting-workspace-"))
  tempDirs.push(dir)
  return dir
}

function bundleUrl(packageDir: string, name: string): string {
  mkdirSync(join(packageDir, "dist"), { recursive: true })
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name, version: "5.1.86" }))
  writeFileSync(join(packageDir, "dist", "index.js"), "")
  return pathToFileURL(join(packageDir, "dist", "index.js")).href
}

// The background update check sends any workspace other than the flat cache and the config dir down the sandbox
// path, so a payload nested under the wrapper must still name the workspace that owns the wrapper.
describe("findModuleHostingWorkspace", () => {
  test.each([
    ["installed directly", ["oh-my-openagent"]],
    ["hoisted beside the wrapper", ["oh-my-opencode"]],
    ["nested under the wrapper", ["oh-my-openagent", "node_modules", "oh-my-opencode"]],
  ])("#given the payload %s #when resolving #then it names the owning workspace", (_layout, packagePath) => {
    // given
    const workspace = workspaceDir()
    const name = packagePath.at(-1) ?? ""
    const moduleUrl = bundleUrl(join(workspace, "node_modules", ...packagePath), name)

    // when / then
    expect(findModuleHostingWorkspace(moduleUrl)).toBe(workspace)
  })

  test("#given a source checkout #when resolving #then there is no hosting workspace", () => {
    // given
    const moduleUrl = bundleUrl(join(workspaceDir(), "oh-my-openagent"), "oh-my-opencode")

    // when / then
    expect(findModuleHostingWorkspace(moduleUrl)).toBeNull()
  })
})
