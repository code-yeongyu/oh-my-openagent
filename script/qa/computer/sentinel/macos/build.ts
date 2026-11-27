import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { HelperPaths } from "./session.ts"

// The helpers are compiled on the QA host itself from the sources beside this file; nothing native is checked in and
// nothing of this ships inside the engine binary. The typist and the idle app are apps a person could switch to, so
// they are built as minimal app bundles: activation through LaunchServices needs a bundle identity.

const SOURCES = {
  recorder: ["wire.swift", "recorder.swift", "recorder-observers.swift", "recorder-samples.swift"],
  typist: ["wire.swift", "typist.swift"],
  planter: ["wire.swift", "planter.swift"],
} as const

async function run(command: readonly string[], what: string): Promise<void> {
  const child = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (code !== 0) throw new Error(`${what} failed: ${stderr.trim().slice(0, 2_000)}`)
}

async function compile(name: keyof typeof SOURCES, output: string): Promise<string> {
  const sources = SOURCES[name].map((file) => join(import.meta.dir, file))
  await run(
    ["swiftc", "-O", "-swift-version", "5", "-parse-as-library", "-o", output, ...sources],
    `swiftc for the ${name}`,
  )
  return output
}

async function bundle(
  outDir: string,
  name: string,
  source: keyof typeof SOURCES,
): Promise<{ app: string; exe: string }> {
  const app = join(outDir, `Sentinel${name}.app`)
  const executable = `sentinel-${name.toLowerCase()}`
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true })
  writeFileSync(
    join(app, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.omo.qa.sentinel.${name.toLowerCase()}</string>
<key>CFBundleName</key><string>Sentinel ${name}</string>
<key>CFBundleExecutable</key><string>${executable}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1</string>
</dict></plist>
`,
  )
  const exe = await compile(source, join(app, "Contents", "MacOS", executable))
  await run(["codesign", "--force", "--sign", "-", app], `ad-hoc signing ${app}`)
  return { app, exe }
}

export async function buildHelpers(outDir: string): Promise<HelperPaths> {
  const [recorder, planter, typist, idle] = await Promise.all([
    compile("recorder", join(outDir, "sentinel-recorder")),
    compile("planter", join(outDir, "sentinel-planter")),
    bundle(outDir, "Typist", "typist"),
    bundle(outDir, "Idle", "planter"),
  ])
  return { recorder, planter, typist: typist.exe, typistApp: typist.app, idle: idle.exe, idleApp: idle.app }
}
