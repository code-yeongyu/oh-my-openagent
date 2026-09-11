#!/usr/bin/env bun
/**
 * Applies live manifest backfill to root CHANGELOG.md.
 * 
 * Usage: bun script/backfill-changelog.ts <manifest-path> [changelog-path]
 * 
 * Returns exit code 0 on success, non-zero on error.
 * On success, outputs the new CHANGELOG content to stdout (or writes in-place with --write).
 */

import { readFileSync, writeFileSync } from "fs"
import { validateManifest, generateBackfillSection, backfillChangelog, type LiveManifest } from "./changelog-backfill-live"

function main() {
  const args = Bun.argv.slice(2)
  const shouldWrite = args.includes("--write")
  const positional = args.filter((a) => !a.startsWith("-"))
  const manifestPath = positional[0]
  const changelogPath = positional[1] ?? "./CHANGELOG.md"

  if (!manifestPath) {
    console.error("Usage: bun script/backfill-changelog.ts <manifest-path> [changelog-path] [--write]")
    process.exit(1)
  }

  let manifest: LiveManifest
  try {
    const data = JSON.parse(readFileSync(manifestPath, "utf-8"))
    manifest = data
  } catch (e) {
    console.error(`Failed to read or parse manifest: ${manifestPath}`)
    console.error(e)
    process.exit(1)
  }

  const validation = validateManifest(manifest)
  if (!validation.valid) {
    console.error("Manifest validation failed:")
    for (const error of validation.errors) {
      console.error(`  - ${error}`)
    }
    process.exit(1)
  }

  let changelog: string
  try {
    changelog = readFileSync(changelogPath, "utf-8")
  } catch (e) {
    console.error(`Failed to read changelog: ${changelogPath}`)
    console.error(e)
    process.exit(1)
  }

  const backfillSection = generateBackfillSection(manifest.releases)
  const result = backfillChangelog(changelog, backfillSection, manifest.fetchedAt)

  if (result.error) {
    console.error(`Backfill error: ${result.error}`)
    process.exit(1)
  }

  if (shouldWrite) {
    try {
      writeFileSync(changelogPath, result.changelog, "utf-8")
      console.log(`✓ Backfilled ${changelogPath}`)
      console.log(`  Manifest: ${manifest.fetchedAt}`)
      console.log(`  Releases: ${manifest.count}`)
      console.log(`  Missing: ${manifest.missing.join(", ")}`)
    } catch (e) {
      console.error(`Failed to write changelog: ${changelogPath}`)
      console.error(e)
      process.exit(1)
    }
  } else {
    console.log(result.changelog)
  }
}

if (import.meta.main) {
  main()
}
