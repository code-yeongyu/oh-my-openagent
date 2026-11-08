#!/usr/bin/env bun
/** Release step: print the GitHub release body for <version>, fail-closed. */
import { composeReleaseBody, extractReleaseNotes } from "./changelog-release-notes"

/** The install line for the released channel: bare `omo-ai` for a stable version, `omo-ai@beta` for a prerelease. */
export function installFooter(version: string): string {
  const spec = version.includes("-") ? "omo-ai@beta" : "omo-ai"
  return ["\`\`\`bash", `bun add -g ${spec}`, "\`\`\`"].join("\n")
}

async function main(): Promise<void> {
  const version = process.argv[2]
  if (!version) {
    console.error("usage: bun script/print-release-notes.ts <version> [contributors-file]")
    process.exit(2)
  }
  const path = new URL("../CHANGELOG.md", import.meta.url)
  const notes = extractReleaseNotes(await Bun.file(path).text(), version)
  const contributorsFile = process.argv[3]
  const contributors = contributorsFile ? await Bun.file(contributorsFile).text() : ""
  process.stdout.write(composeReleaseBody(notes, contributors, installFooter(version)))
}

if (import.meta.main) await main()
