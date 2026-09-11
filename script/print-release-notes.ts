#!/usr/bin/env bun
/** Release step: print the GitHub release body for <version>, fail-closed. */
import { composeReleaseBody, extractReleaseNotes } from "./changelog-release-notes"

const INSTALL_FOOTER = ["\`\`\`bash", "npm i -g omo-ai@beta", "\`\`\`"].join("\n")

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
  process.stdout.write(composeReleaseBody(notes, contributors, INSTALL_FOOTER))
}

if (import.meta.main) await main()
