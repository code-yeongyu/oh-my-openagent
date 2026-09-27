#!/usr/bin/env bun
// Install (or --remove) the desktop engine sidecar descriptor in the bunshin agent's capability directory.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { desktopDescriptor } from "../packages/senpi-desktop-engine/bunshin/descriptor.mjs"
import { locateDesktopEngine } from "../packages/senpi-desktop-engine/src/locator.ts"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const { values } = parseArgs({ options: { engine: { type: "string" }, remove: { type: "boolean", default: false } } })
const bunshinHome = process.env.BUNSHIN_HOME ?? join(homedir(), ".bunshin")
const capabilityDir = process.env.BUNSHIN_CAPABILITY_DIR ?? join(bunshinHome, "capabilities")
const target = join(capabilityDir, "desktop.json")

if (values.remove) {
  rmSync(target, { force: true })
  console.log(`removed ${target}`)
  process.exit(0)
}

const located = values.engine === undefined ? locateDesktopEngine({ repoRoot }) : undefined
const executable = values.engine === undefined ? located?.path : resolve(values.engine)
if (executable === undefined || executable === null) {
  console.error(located?.diagnostic?.message ?? "The desktop engine is unavailable.")
  process.exit(1)
}

const { version } = JSON.parse(readFileSync(join(repoRoot, "packages/senpi-desktop-engine/package.json"), "utf8"))
mkdirSync(capabilityDir, { recursive: true })
writeFileSync(target, `${JSON.stringify(desktopDescriptor({ executable, version, bunshinHome }), null, "\t")}\n`)
console.log(`installed ${target} (engine ${executable})`)
if (process.env.BUNSHIN_CAPABILITY_DIR === undefined) {
  console.log(`start the bunshin agent with BUNSHIN_CAPABILITY_DIR=${capabilityDir} so it loads the descriptor`)
}
