import { join } from "node:path"

import type { HelperPaths } from "./session.ts"

// The helpers are compiled on the QA host itself from the sources beside this file; nothing native is checked in and
// nothing of this ships inside the engine binary.

const SOURCES: Readonly<Record<keyof HelperPaths, readonly string[]>> = {
  recorder: ["wire.swift", "recorder.swift", "recorder-samples.swift"],
  typist: ["wire.swift", "typist.swift"],
  planter: ["wire.swift", "planter.swift"],
}

async function compile(name: keyof HelperPaths, outDir: string): Promise<string> {
  const output = join(outDir, `sentinel-${name}`)
  const sources = SOURCES[name].map((file) => join(import.meta.dir, file))
  const swiftc = Bun.spawn(["swiftc", "-O", "-swift-version", "5", "-parse-as-library", "-o", output, ...sources], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stderr] = await Promise.all([swiftc.exited, new Response(swiftc.stderr).text()])
  if (code !== 0) throw new Error(`swiftc failed for the ${name}: ${stderr.trim().slice(0, 2_000)}`)
  return output
}

export async function buildHelpers(outDir: string): Promise<HelperPaths> {
  const [recorder, typist, planter] = await Promise.all([
    compile("recorder", outDir),
    compile("typist", outDir),
    compile("planter", outDir),
  ])
  return { recorder, typist, planter }
}
