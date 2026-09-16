import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSdkRootProvisioning } from "./sdk-root-provisioning"
import { composeOmoSenpiExtension } from "./compose"
import { FakeExtensionAPI } from "../../test-support/fake-extension-api"

test("#given extension activation #when a component registers #then both SDK roots are already published", async () => {
  const keys = ["OMO_DAG_SDK_ROOT", "OMO_AGENT_TOOLKIT_SDK_ROOT"]
  const saved = keys.map(key => process.env[key])
  try {
    for (const key of keys) delete process.env[key]
    let registered = false
    await composeOmoSenpiExtension([{ name: "probe", register() {
      for (const key of keys) {
        const root = process.env[key]
        expect(root).toBeDefined()
        expect(existsSync(join(root ?? "", "sdk.js"))).toBe(true)
      }
      registered = true
    } }])(new FakeExtensionAPI())
    expect(registered).toBe(true)
  } finally {
    keys.forEach((key, i) => { const value = saved[i]; if (value === undefined) delete process.env[key]; else process.env[key] = value })
  }
})

const roots: string[] = []
const key = "OMO_TEST_SDK_ROOT"
afterEach(() => { delete process.env[key]; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

test("#given an SDK directory #when provisioned #then only an existing root is published", () => {
  const root = mkdtempSync(join(tmpdir(), "sdk-root-"))
  roots.push(root)
  const options = { envKey: key, packagedRelativeDir: "../runtime/example", sourceTreeRelativeDir: "../../plugin/runtime/example" }
  expect(() => createSdkRootProvisioning({ ...options, baseDir: join(root, "absent") })()).not.toThrow()
  expect(process.env[key]).toBeUndefined()
  createSdkRootProvisioning({ ...options, baseDir: root })()
  expect(process.env[key]).toBe(root)
})
