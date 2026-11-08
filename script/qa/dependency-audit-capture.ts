#!/usr/bin/env bun
import { join } from "node:path"
import { z } from "zod"
import { CASES, parseCaptureArgs, type CaseName } from "./dependency-audit/contracts"
import { createRuntime, disposeRuntime, normalized, type Runtime } from "./dependency-audit/runtime"
import { captureBytes, captureSkills, captureTargetBytes } from "./dependency-audit/inventory"
import { captureGraph } from "./dependency-audit/graph"
import { captureStartup } from "./dependency-audit/startup"
import { captureRpc, captureExtension, capturePhoton } from "./dependency-audit/session-cases"
import { captureWebfetch } from "./dependency-audit/webfetch"
import { captureProviders } from "./dependency-audit/providers"
import { captureChangelog } from "./dependency-audit/changelog"

const captures: Readonly<Record<CaseName, (runtime: Runtime) => Promise<object>>> = {
  bytes: captureBytes, graph: captureGraph, startup: captureStartup, rpc: captureRpc, extension: captureExtension,
  webfetch: captureWebfetch, photon: capturePhoton, changelog: captureChangelog, providers: captureProviders,
  skills: captureSkills, "bytes-targets": captureTargetBytes,
}
export async function capture(args: readonly string[]): Promise<void> {
  const options = parseCaptureArgs(args)
  const results = []
  for (const name of options.case === undefined ? CASES : [options.case]) {
    const runtime = await createRuntime(options)
    const timestamp = new Date().toISOString()
    let observables: object
    let cleanup: string
    try {
      observables = await captures[name](runtime)
    } catch (error) {
      if (!(error instanceof Error)) throw error
      observables = { pass: false, error: { name: error.name, message: error.message } }
    } finally { cleanup = await disposeRuntime(runtime) }
    const receipt = z.record(z.string(), z.json()).parse(normalized(runtime, {
      command: ["bun", "script/qa/dependency-audit-capture.ts", ...args], machine: runtime.machine, versions: runtime.versions,
      exitCode: z.object({ pass: z.boolean() }).parse(observables).pass ? 0 : 1, timestamp,
      schemaVersion: 1, phase: options.phase, case: name, binarySha256: runtime.sha256,
      ...observables, commands: runtime.commands, cleanup,
    }))
    await Bun.write(join(runtime.out, `${name}.json`), `${JSON.stringify(receipt, null, 2)}\n`)
    results.push(receipt)
    console.log(JSON.stringify({ case: name, pass: receipt.pass, exitCode: receipt.exitCode }))
  }
  await Bun.write(join(options.out, "summary.json"), `${JSON.stringify({
    command: ["bun", "script/qa/dependency-audit-capture.ts", ...args], machine: results[0]?.machine,
    versions: results[0]?.versions, exitCode: 0, timestamp: new Date().toISOString(), schemaVersion: 1, phase: options.phase,
    complete: results.length === (options.case === undefined ? CASES.length : 1),
    pass: results.every((result) => result.pass === true), cases: results,
    cleanup: results.map((result) => ({ case: result.case, receipt: result.cleanup })),
  }, null, 2)}\n`)
}
if (import.meta.main) {
  try { await capture(process.argv.slice(2)) }
  catch (error) {
    if (!(error instanceof Error)) throw error
    console.error(JSON.stringify({ error: error.name, message: error.message }))
    process.exitCode = 1
  }
}
