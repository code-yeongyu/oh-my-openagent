/// <reference types="bun-types" />

import { mkdirSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { ExtensionContext } from "@code-yeongyu/senpi"
import { mock as mockFn } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { getOmoNativeStateDir } from "../telemetry/product-identity"
import { processStartTime } from "./component"
import {
  cleanupTempDirs,
  commitAll,
  initRepo,
  makeDirWithSourceFiles,
  makeTempDir,
  writeFileAt,
} from "./fixtures.test-support"

const originalAgentDirs = {
  OMO_CODING_AGENT_DIR: process.env.OMO_CODING_AGENT_DIR,
  SENPI_CODING_AGENT_DIR: process.env.SENPI_CODING_AGENT_DIR,
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
} as const

export const componentContext: ComponentContext = {
  logger: { info() {}, warn() {}, error() {} },
  config: { getFlag: () => false },
}

export class AdvisorFakeExtensionAPI extends FakeExtensionAPI {
  readonly appendEntry = mockFn((_customType: string, _data?: unknown): void => {})
}

export type SelectImplementation = (
  title: string,
  options: string[],
  opts?: { timeout?: number },
) => Promise<string | undefined>

export function setTestHome(marker: "old" | "current" | "missing" = "old"): string {
  const home = makeTempDir("omo-init-deep-home-")
  process.env.OMO_CODING_AGENT_DIR = home
  process.env.SENPI_CODING_AGENT_DIR = home
  process.env.PI_CODING_AGENT_DIR = home
  if (marker === "missing") return home
  const stateDir = getOmoNativeStateDir(process.env)
  mkdirSync(stateDir, { recursive: true })
  const markerPath = join(stateDir, "onboarding-completed")
  writeFileSync(markerPath, "{}")
  const mtime = marker === "old" ? processStartTime - 10_000 : processStartTime + 10_000
  utimesSync(markerPath, mtime / 1_000, mtime / 1_000)
  return home
}

export function resetTestHome(): void {
  for (const [name, value] of Object.entries(originalAgentDirs)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  cleanupTempDirs()
}

export function makeCoverageRepo(covered = false): string {
  const root = initRepo()
  makeDirWithSourceFiles(root, "src", 8)
  if (covered) writeFileAt(root, "AGENTS.md", "# Guide\n")
  commitAll(root, "fixture")
  return root
}

export function makeStaleRepo(agentsMode?: "committed" | "local"): string {
  const root = initRepo()
  makeDirWithSourceFiles(root, "src", 8)
  if (agentsMode === "committed") writeFileAt(root, "AGENTS.md", "# Guide\n")
  commitAll(root, "fixture")
  if (agentsMode === "local") writeFileAt(root, "AGENTS.md", "# Guide\n")
  writeFileAt(
    root,
    ".omo/init-deep.json",
    "invalid",
  )
  return root
}

export function createHarness(
  root: string,
  choice: string | undefined = undefined,
  hasUI = true,
  selectImplementation?: SelectImplementation,
) {
  const pi = new AdvisorFakeExtensionAPI()
  const select = mockFn(
    selectImplementation ??
      (async (_title: string, _options: string[], _opts?: { timeout?: number }) => choice),
  )
  const eventCtx = { cwd: root, hasUI, ui: { select } } as unknown as ExtensionContext
  return { pi, select, eventCtx }
}

export function advisorStateDir(): string {
  return join(getOmoNativeStateDir(process.env), "init-deep-advisor-state")
}
