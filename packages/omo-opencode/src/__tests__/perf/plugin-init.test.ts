import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { describe, expect, it } from "bun:test"

type InitMetrics = {
  coldMs: number
  warmMs: [number, number]
  medianMs: number
}

function getMedian(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function createPluginInput(directory: string): PluginInput {
  const client = createOpencodeClient({ directory })

  return {
    client,
    project: {
      id: `perf-${Date.now()}`,
      worktree: directory,
      time: { created: Date.now() },
    },
    directory,
    worktree: directory,
    serverUrl: new URL("http://localhost"),
    $: Bun.$,
  }
}

async function importFreshPluginModule(): Promise<(typeof import("../../index"))["default"]> {
  const token = `${Date.now()}-${Math.random()}`
  return (await import(`../../index?perf=${token}`)).default
}

async function measureInitMetrics(directory: string): Promise<InitMetrics> {
  const pluginModule = await importFreshPluginModule()
  const measurements: number[] = []

  for (let index = 0; index < 3; index += 1) {
    const input = createPluginInput(directory)
    const start = performance.now()
    await pluginModule.server(input, {})
    measurements.push(performance.now() - start)
  }

  return {
    coldMs: measurements[0] ?? 0,
    warmMs: [measurements[1] ?? 0, measurements[2] ?? 0],
    medianMs: getMedian(measurements),
  }
}

async function measureScenario(
  label: string,
  populateDirectory: (directory: string) => void,
): Promise<InitMetrics> {
  const rootDirectory = mkdtempSync(join(tmpdir(), "perf-d09-"))
  const projectDirectory = join(rootDirectory, label)
  const configDirectory = join(rootDirectory, "opencode-config")
  const previousConfigDirectory = process.env.OPENCODE_CONFIG_DIR

  mkdirSync(configDirectory, { recursive: true })
  process.env.OPENCODE_CONFIG_DIR = configDirectory

  try {
    populateDirectory(projectDirectory)
    return await measureInitMetrics(projectDirectory)
  } finally {
    if (previousConfigDirectory === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = previousConfigDirectory
    }

    rmSync(rootDirectory, { recursive: true, force: true })
  }
}

function logMetrics(label: string, metrics: InitMetrics): void {
  console.info(
    `${label}: cold=${metrics.coldMs.toFixed(1)}ms warm=[${metrics.warmMs.map((value) => value.toFixed(1)).join(", ")}] median=${metrics.medianMs.toFixed(1)}ms`,
  )
}

describe("plugin init performance", () => {
  it("stays within the empty project init budget", async () => {
    // given
    const metrics = await measureScenario("empty-project", (directory) => {
      mkdirSync(directory, { recursive: true })
    })

    // when
    logMetrics("empty-project", metrics)

    // then
    // regression budget
    expect(metrics.medianMs).toBeLessThan(500)
  })

  it("stays within the in-tree fixture init budget", async () => {
    // given
    const fixtureDirectory = new URL("./fixtures/in-tree/", import.meta.url)
    const metrics = await measureScenario("in-tree-fixture", (directory) => {
      cpSync(fixtureDirectory, directory, { recursive: true })
    })

    // when
    logMetrics("in-tree-fixture", metrics)

    // then
    // regression budget
    expect(metrics.medianMs).toBeLessThan(700)
  })
})
