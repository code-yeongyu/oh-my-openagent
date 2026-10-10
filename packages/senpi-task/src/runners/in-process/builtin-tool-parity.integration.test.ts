import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ResourceLoader } from "@code-yeongyu/senpi"

import { loadSenpiBarrel } from "../../lazy/senpi-barrel"
import { createChildResourceLoader } from "./child-loader"

const roots: string[] = []

function builtinToolNames(loader: ResourceLoader): string[] {
  return [...new Set(loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()]))].sort()
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() ?? "", { recursive: true, force: true })
})

describe("in-process child builtin tool parity", () => {
  test("#given the process child loader policy #when the in-process loader reloads #then builtin tool names match with web_search available", async () => {
    const root = mkdtempSync(join(tmpdir(), "omo-child-tools-parity-"))
    roots.push(root)
    const agentDir = join(root, "agent")
    const cwd = join(root, "work")
    mkdirSync(agentDir, { recursive: true })
    mkdirSync(cwd, { recursive: true })

    const senpi = await loadSenpiBarrel()
    const settingsManager = senpi.SettingsManager.inMemory()
    const processLoader = new senpi.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionsOverride: (loaded) => {
        loaded.runtime.flagValues.set("no-ask-user", true)
        return loaded
      },
    })
    const inProcessLoader = createChildResourceLoader({ cwd, agentDir, settingsManager })

    await Promise.all([processLoader.reload(), inProcessLoader.reload()])
    const processTools = builtinToolNames(processLoader)
    const inProcessTools = builtinToolNames(inProcessLoader)

    expect(inProcessTools).toContain("web_search")
    expect(inProcessTools).toHaveLength(processTools.length)
    expect(inProcessTools).toEqual(processTools)
  })
})
