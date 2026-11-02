import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { TELEMETRY_INSTALL_DISCLOSURE_LINES } from "./install-disclosure"

const repoRoot = join(import.meta.dir, "..", "..", "..")

function disclosureBlock(printed: readonly string[]): readonly string[] {
  const start = printed.indexOf(TELEMETRY_INSTALL_DISCLOSURE_LINES[0])
  return start < 0 ? [] : printed.slice(start, start + TELEMETRY_INSTALL_DISCLOSURE_LINES.length)
}

function printedLines(source: string, pattern: RegExp): readonly string[] {
  return [...source.matchAll(pattern)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
}

describe("telemetry install disclosure shipped copies", () => {
  // Shipped-copy equality: the shell installers and `omo setup` cannot import telemetry-core.
  test("#given install.sh #when its printed lines are read #then the disclosure block equals the source", () => {
    const source = readFileSync(join(repoRoot, "packages", "get-worker", "scripts", "install.sh"), "utf8")

    expect(disclosureBlock(printedLines(source, /^\s*say "(.*)"$/gm))).toEqual(TELEMETRY_INSTALL_DISCLOSURE_LINES)
  })

  test("#given install.ps1 #when its printed lines are read #then the disclosure block equals the source", () => {
    const source = readFileSync(join(repoRoot, "packages", "get-worker", "scripts", "install.ps1"), "utf8")

    expect(disclosureBlock(printedLines(source, /^\s*Write-OmoSay '(.*)'\r?$/gm))).toEqual(TELEMETRY_INSTALL_DISCLOSURE_LINES)
  })

  test("#given omo setup #when its telemetry notice is loaded #then it equals the source", async () => {
    const setupSummary = pathToFileURL(join(repoRoot, "packages", "omo-native", "bin", "lib", "setup-summary.js")).href
    const { TELEMETRY_NOTICE } = await import(setupSummary)

    expect(TELEMETRY_NOTICE).toBe(TELEMETRY_INSTALL_DISCLOSURE_LINES.join("\n"))
  })
})
