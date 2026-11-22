/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// #12965: the engine refuses to load next to a redaction registry slot it did not pin, and that refusal is permanent
// for the process. A child start awaits loadSenpiBarrel(), so the load must fail with the remedy (a restart) instead
// of the raw import error. Each case runs in a fresh Bun process whose loader makes the engine module's own evaluation
// throw, which is how the engine refuses; the barrel promise is process-wide and cannot be reset in this process.

const BARREL = pathToFileURL(fileURLToPath(new URL("./senpi-barrel.ts", import.meta.url))).href
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function loadWithEngineThrowing(thrown: string): Record<string, unknown> {
  const root = mkdtempSync(join(tmpdir(), "senpi-barrel-load-failure-"))
  roots.push(root)
  const script = join(root, "load.ts")
  writeFileSync(
    script,
    `Bun.plugin({
  setup(build) {
    build.onLoad({ filter: /@code-yeongyu[\\\\/]senpi[\\\\/]dist[\\\\/]index\\.js$/ }, () => ({ contents: ${JSON.stringify(thrown)}, loader: "js" }))
  },
})
const { loadSenpiBarrel, SenpiEngineRestartRequiredError } = await import(${JSON.stringify(BARREL)})
const failure = await loadSenpiBarrel().then(() => undefined, (error) => error)
console.log(JSON.stringify({
  restartRequired: failure instanceof SenpiEngineRestartRequiredError,
  name: failure?.name,
  code: failure?.code,
  causeName: failure?.cause?.name,
  message: failure?.message,
}))
`,
  )
  const child = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 20_000 })
  if (child.status !== 0) throw new Error(`load script exited ${String(child.status)}: ${child.stderr}`)
  return JSON.parse(child.stdout) as Record<string, unknown>
}

describe("senpi barrel load failure", () => {
  it("#given the engine refuses its redaction registry slot #when the barrel loads #then the load fails as restart-required, carrying the refusal", () => {
    // given
    const refusal = `const error = new Error("The process-wide redaction registry was not installed by senpi"); error.name = "ConfigReferenceRedactionSlotError"; error.code = "SENPI_REDACTION_SLOT_INCOMPATIBLE"; throw error;`

    // when
    const out = loadWithEngineThrowing(refusal)

    // then
    expect(out).toMatchObject({
      restartRequired: true,
      name: "SenpiEngineRestartRequiredError",
      code: "SENPI_REDACTION_SLOT_INCOMPATIBLE",
      causeName: "ConfigReferenceRedactionSlotError",
    })
  }, 30_000)

  it("#given any other engine load failure #when the barrel loads #then the original error is kept", () => {
    // given
    const unrelated = `const error = new Error("engine failed to start"); error.name = "TypeError"; throw error;`

    // when
    const out = loadWithEngineThrowing(unrelated)

    // then
    expect(out).toMatchObject({ restartRequired: false, name: "TypeError", message: "engine failed to start" })
  }, 30_000)
})
