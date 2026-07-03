/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const packageManifestPath = new URL("../package.json", import.meta.url)
const ciWorkflowPath = new URL("../.github/workflows/ci.yml", import.meta.url)

function readPackageScript(name: string): string {
  const manifest = JSON.parse(readFileSync(packageManifestPath, "utf8")) as {
    readonly scripts?: Record<string, string>
  }
  const script = manifest.scripts?.[name]
  if (typeof script !== "string") throw new Error(`missing package script ${name}`)
  return script
}

function sliceWorkflowSection(workflow: string, startMarker: string, endMarker: string): string {
  const start = workflow.indexOf(startMarker)
  const end = workflow.indexOf(endMarker, start)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`missing workflow section between ${startMarker} and ${endMarker}`)
  }
  return workflow.slice(start, end)
}

describe("Senpi compatibility test script", () => {
  test("#given root scripts #when test:senpi is inspected #then it runs the hermetic adapter gate in order", () => {
    // #given
    const script = readPackageScript("test:senpi")

    // #when
    const expectedCommands = [
      "node packages/omo-senpi/plugin/scripts/build-extension.mjs",
      "node packages/omo-senpi/plugin/scripts/sync-skills.mjs",
      "node packages/omo-senpi/plugin/scripts/embed-directive.mjs --check",
      "bun test packages/omo-senpi",
    ]
    const commandIndexes = expectedCommands.map((command) => script.indexOf(command))
    let isOrdered = true
    for (let index = 0; index < commandIndexes.length; index += 1) {
      const current = commandIndexes[index]
      const previous = index === 0 ? -1 : commandIndexes[index - 1]
      if (current === undefined || previous === undefined || current < 0 || current <= previous) isOrdered = false
    }

    // #then
    expect(isOrdered, "test:senpi must build, sync skills, verify directive, then run package tests").toBe(true)
    expect(script, "test:senpi must stay hermetic and not run a live senpi install").not.toContain("senpi install")
  })

  test("#given CI workflow #when inspected #then senpi compatibility is a merge-blocking matrix job", () => {
    // #given
    const workflow = readFileSync(ciWorkflowPath, "utf8")

    // #when
    const senpiJob = sliceWorkflowSection(workflow, "  senpi-compatibility:", "  lazycodex-published-smoke:")
    const needsReferences = workflow.match(/needs: \[[^\]]*senpi-compatibility[^\]]*\]/g) ?? []

    // #then
    expect(senpiJob).toContain("os: [ubuntu-latest, macos-latest, windows-latest]")
    expect(senpiJob).toContain('node-version: "24"')
    expect(senpiJob).toContain('bun-version: "1.3.12"')
    expect(senpiJob).toContain("run: bun run test:senpi")
    expect(senpiJob).not.toContain("senpi install")
    expect(needsReferences.length, "senpi-compatibility must be included in both downstream needs lists").toBeGreaterThanOrEqual(2)
  })
})
