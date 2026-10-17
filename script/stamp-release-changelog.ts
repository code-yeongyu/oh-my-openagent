#!/usr/bin/env bun
/** Release-state step: stamp ## [Unreleased] into the released section for <version>. */
import { stampUnreleased } from "./changelog-release-notes"

async function main(): Promise<void> {
  const version = process.argv[2]
  const date = process.argv[3] ?? new Date().toISOString().slice(0, 10)
  if (!version) {
    console.error("usage: bun script/stamp-release-changelog.ts <version> [YYYY-MM-DD]")
    process.exit(2)
  }
  const path = new URL("../CHANGELOG.md", import.meta.url)
  const stamped = stampUnreleased(await Bun.file(path).text(), version, date)
  await Bun.write(path, stamped)
  console.error(`stamped ## [${version}] - ${date}`)
}

if (import.meta.main) await main()
