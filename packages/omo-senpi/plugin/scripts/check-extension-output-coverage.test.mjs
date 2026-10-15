import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { appendFile, mkdir, rename, rm } from "node:fs/promises"
import { join } from "node:path"

import { checkExtensionCurrent } from "./build-extension.mjs"
import { createBuildFixture } from "./build-extension.test-support.mjs"

const fixture = createBuildFixture()
setDefaultTimeout(90_000)
afterEach(fixture.cleanupTest)
afterAll(fixture.cleanupFile)

describe("gateway rules extension freshness", () => {
  test("#given a built plugin without its gateway rules sidecar #when checked #then the missing output is named", async () => {
    const outputs = await fixture.mutableOutputs()
    const sidecar = join(outputs.root, "gateway-rules-extension.mjs")
    await rm(sidecar)
    expect(await checkExtensionCurrent(outputs)).toMatchObject({ ok: false, reason: "missing-output", output: sidecar })
  })

  test("#given a stale gateway rules sidecar #when checked #then its bytes cannot escape the freshness comparison", async () => {
    const outputs = await fixture.mutableOutputs()
    const sidecar = join(outputs.root, "gateway-rules-extension.mjs")
    await appendFile(sidecar, "\n// changed sidecar\n")
    expect(await checkExtensionCurrent(outputs)).toMatchObject({ ok: false, reason: "stale-output", output: sidecar })
  })

  test("#given outputs explicitly redirected outside the checkout #when checked #then no Git tracking is required", async () => {
    const outputs = await fixture.sharedOutputs()
    expect(await checkExtensionCurrent(outputs)).toMatchObject({ ok: true, output: outputs.outputPath })
  })

  test("#given an explicit gateway sidecar path #when checked #then that path is read and compared", async () => {
    const outputs = await fixture.mutableOutputs()
    const custom = join(outputs.root, "custom", "rules.mjs")
    await mkdir(join(outputs.root, "custom"))
    await rename(join(outputs.root, "gateway-rules-extension.mjs"), custom)
    const options = { ...outputs, gatewayRulesExtensionOutputPath: custom }
    expect(await checkExtensionCurrent(options)).toMatchObject({ ok: true })
    await appendFile(custom, "\n// changed explicit sidecar\n")
    expect(await checkExtensionCurrent(options)).toMatchObject({ ok: false, reason: "stale-output", output: custom })
  })
})
